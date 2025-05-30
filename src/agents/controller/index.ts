import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { groq } from "@ai-sdk/groq";
import { anthropic } from "@ai-sdk/anthropic";
import { verifyGitHubWebhook } from "../../utils/github";
import { callDevinAPI } from "../../utils/devin";
import { generateEventKey } from "../../utils/events";

// Supported repositories
const SUPPORTED_REPOSITORIES = [
	{
		name: "cli",
		url: "https://github.com/agentuity/cli",
		type: "CLI Tool",
	},
	{
		name: "sdk-js",
		url: "https://github.com/agentuity/sdk-js",
		type: "JavaScript SDK",
	},
	{
		name: "sdk-py",
		url: "https://github.com/agentuity/sdk-py",
		type: "Python SDK",
	},
];

const WebhookAnalysisSchema = z.object({
	isReleaseOrTagEvent: z.boolean(),
	eventType: z.enum(["release", "tag", "other"]),
	repositoryName: z.string(),
	version: z.string(),
	reasoning: z.string(),
	isSupported: z.boolean(),
});

export default async function ChangelogAgent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	try {
		ctx.logger.info("Received webhook request", {
			env: process.env.AGENTUITY_ENVIRONMENT,
			metadata: req.metadata,
			data: await req.data.text(),
		});

		if (process.env.AGENTUITY_ENVIRONMENT === "development") {
			ctx.logger.info(
				"Running in local development mode - skipping webhook signature verification",
			);
		} else {
			// Verify GitHub webhook signature
			const verificationResult = await verifyGitHubWebhook(req, ctx);
			if (!verificationResult.success) {
				return resp.json({
					status: "error",
					message: verificationResult.message || "Unknown verification error",
				});
			}
		}

		// Use Groq for the webhook payload analysis
		const groqModel = groq("meta-llama/llama-4-scout-17b-16e-instruct");
		const { payload } = await req.data.object<{
			payload?: { action?: string };
		}>();

		// Step 1: Let the LLM analyze the webhook payload using Groq (faster and cheaper)
		const { object: analysis } = await generateObject({
			model: groqModel,
			schema: WebhookAnalysisSchema,
			prompt: `
You are a GitHub webhook analyst for a changelog automation system.

Analyze this GitHub webhook payload and extract the following information:

${await req.data.text()}

Consider:
1. Supported repositories: ${SUPPORTED_REPOSITORIES.map((r) => `${r.name} - ${r.type} - ${r.url}`).join(", ")}
2. Event types: release or tag
3. If this is a release, the version should be in release.tag_name
4. If this is a tag, the version should be the last part of the ref (format: refs/tags/v1.0.0)
5. For release events, check if action is "published" - only process published releases
6. For tag events, check if created is true - only process newly created tags
7. If the release or tag contains "-next" in the version, it should be ignored

Provide your analysis based on the schema requirements.
`,
		});

		ctx.logger.info("Webhook analysis:", analysis);

		// If not a release or tag event, or not a supported repo, return early
		if (!analysis.isReleaseOrTagEvent || !analysis.isSupported) {
			return resp.json({
				status: "ignored",
				reason: analysis.reasoning,
			});
		}

		// Check if we've already processed this event
		const eventKey = generateEventKey(
			analysis.repositoryName,
			analysis.version,
			analysis.eventType,
		);

		// Try to get the event from KV store
		const kvEventStore = await ctx.kv.get(
			"agent-changelog-processed-events",
			eventKey,
		);
		const existingEvent = kvEventStore.exists;
		ctx.logger.info("Existing event:", {
			eventKey,
			existingEvent,
		});

		if (existingEvent) {
			ctx.logger.info("Event already processed:", {
				eventKey,
				existingEvent,
			});

			return resp.json({
				status: "already_processed",
				repository: analysis.repositoryName,
				eventType: analysis.eventType,
				version: analysis.version,
				message: "This event has already been processed",
			});
		}

		// For release events, check if the action is "published"
		if (analysis.eventType === "release") {
			// GitHub webhook payloads have action at the top level for release events
			const action = payload?.action;
			if (action !== "published") {
				ctx.logger.info("Ignoring non-published release event:", {
					action,
				});

				return resp.json({
					status: "ignored",
					reason: "Only published releases are processed",
				});
			}
		}

		// Use Anthropic for the more complex task of generating Devin prompt
		const anthropicModel = anthropic("claude-3-7-sonnet-20250219");

		// Step 2: Generate a comprehensive prompt for Devin
		const { text: devinPrompt } = await generateText({
			model: anthropicModel,
			prompt: `
Generate a detailed prompt for Devin AI to update a changelog. 
Devin will use this prompt to update the changelog for a given repository, update the docs changelog too, etc.

Repository: ${analysis.repositoryName}
Event Type: ${analysis.eventType}
Version: ${analysis.version || "unknown - figure it out"}

Consider:
- Link all the PRs that were merged in this release by comparing all the changes since the previous release
- Changelogs should follow Keep a Changelog format (https://keepachangelog.com/)
- Include repository-specific considerations
- Changelogs in the repo can be found in the CHANGELOG.md file
- Create a PR and ping the team on Slack when it is created

MUST INCLUDE THIS VERBIAGE: The documentation changelog page for the respective topic needs 
to be updated in the docs repository: https://github.com/agentuity/docs.
Don't create a new page, we already have them (sdk-js, sdk-py, etc). Make sure you format 
following the previous release examples

For the docs repo, be aware that the table of contents are auto-generated from the markdown headings.
So don't add "changes" as a heading, make it a bolded line item instead. The version should be the heading.

<IMPORTANT>
There are is an existing changelog file so use that. 
DO NOT create a new file anywhere. 
No new links in the doc repo, no new .md file, etc.  
Just use the existing changelog file at the target.
Do NOT remove old release notes.  
Add new release notes to the top of the file  after the heading and any ancillary text.  
A good way to reference is look at the last several release / changelog notes
in the file and put it just before that one.
Make sure you match the style and format of the existing notes.
</IMPORTANT>

Original payload information:
${await req.data.text()}
`,
		});

		ctx.logger.info("Generated Devin prompt", {
			prompt: devinPrompt,
		});

		// Step 3: Call Devin API with the generated prompt
		const devinResponse = await callDevinAPI(devinPrompt, ctx);

		// Store the event in KV store to prevent duplicate processing
		await ctx.kv.set("agent-changelog-processed-events", eventKey, {
			repository: analysis.repositoryName,
			version: analysis.version,
			eventType: analysis.eventType,
			processedAt: new Date().toISOString(),
			devinSessionId: devinResponse.sessionId,
		});

		return resp.json({
			status: "success",
			repository: analysis.repositoryName,
			eventType: analysis.eventType,
			version: analysis.version,
			devinSessionId: devinResponse.sessionId,
		});
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		ctx.logger.error("Error processing webhook: %o", error);

		return resp.json({
			status: "error",
			message: errorMessage,
		});
	}
}
