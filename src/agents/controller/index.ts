import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { groq } from "@ai-sdk/groq";
import { anthropic } from "@ai-sdk/anthropic";
import { verifyGitHubWebhook } from "../../utils/github";
import { callDevinAPI } from "../../utils/devin";

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
			env: process.env.AGENTUITY_ENV,
		});

		if (process.env.AGENTUITY_ENV === "development") {
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
		const groqModel = groq("llama3-70b-8192");
		const payload = req.data.json;

		// Step 1: Let the LLM analyze the webhook payload using Groq (faster and cheaper)
		const { object: analysis } = await generateObject({
			model: groqModel,
			schema: WebhookAnalysisSchema,
			prompt: `
You are a GitHub webhook analyst for a changelog automation system.

Analyze this GitHub webhook payload and extract the following information:
${JSON.stringify(payload, null, 2)}

Consider:
1. Supported repositories: ${SUPPORTED_REPOSITORIES.map((r) => `${r.name} - ${r.type} - ${r.url}`).join(", ")}
2. Event types: release or tag
3. If this is a release, the version should be in release.tag_name
4. If this is a tag, the version should be the last part of the ref (format: refs/tags/v1.0.0)

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

Original payload information:
${JSON.stringify(payload, null, 2)}
`,
		});

		ctx.logger.info("Generated Devin prompt", {
			prompt: devinPrompt,
		});

		// Step 3: Call Devin API with the generated prompt
		// const devinResponse = await callDevinAPI(devinPrompt, ctx);

		return resp.json({
			status: "success",
			repository: analysis.repositoryName,
			eventType: analysis.eventType,
			version: analysis.version,
			// devinSessionId: devinResponse.sessionId,
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
