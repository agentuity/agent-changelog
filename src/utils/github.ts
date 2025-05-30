import type { AgentRequest, AgentContext } from "@agentuity/sdk";
import { verify } from "@octokit/webhooks-methods";

/**
 * Verifies the GitHub webhook signature
 * @param req The incoming request
 * @param ctx The agent context
 * @returns Result object with success status and optional error message
 */
export async function verifyGitHubWebhook(
	req: AgentRequest,
	ctx: AgentContext,
): Promise<{ success: boolean; message?: string }> {
	const headers = req.get("headers") as Record<string, string>;
	const signature = headers?.["x-hub-signature-256"] as string;
	const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

	if (!signature) {
		ctx.logger.error("No X-Hub-Signature-256 header found in the request");
		return {
			success: false,
			message: "Missing X-Hub-Signature-256 header",
		};
	}

	if (!webhookSecret) {
		ctx.logger.error("GITHUB_WEBHOOK_SECRET environment variable not set");
		return {
			success: false,
			message: "Server configuration error: webhook secret not configured",
		};
	}

	// Verify the signature
	try {
		// Get the webhook payload as a string
		const payload = await req.data.text();
		const isValid = await verify(webhookSecret, payload, signature);

		if (!isValid) {
			ctx.logger.error("Invalid webhook signature");
			return {
				success: false,
				message: "Invalid webhook signature",
			};
		}

		ctx.logger.info("Webhook signature verified successfully");
		return { success: true };
	} catch (verificationError) {
		ctx.logger.error(
			"Error verifying webhook signature: %o",
			verificationError,
		);
		return {
			success: false,
			message: "Error verifying webhook signature",
		};
	}
}
