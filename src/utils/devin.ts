import type { AgentContext } from "@agentuity/sdk";

interface DevinApiResponse {
	sessionId: string;
	[key: string]: unknown;
}

/**
 * Call the Devin API to process the changelog
 * @param prompt The prompt to send to Devin
 * @param ctx The agent context
 * @returns Result object with sessionId and status
 */
export async function callDevinAPI(prompt: string, ctx: AgentContext) {
	try {
		ctx.logger.info("Calling Devin API");

		const response = await fetch("https://api.devin.ai/v1/sessions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.DEVIN_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ prompt }),
		});

		if (!response.ok) {
			throw new Error(
				`Devin API returned ${response.status}: ${await response.text()}`,
			);
		}

		const data = (await response.json()) as DevinApiResponse;

		ctx.logger.info("Devin API response:", {
			statusCode: response.status,
			sessionId: data.sessionId || "unknown",
		});

		return {
			sessionId: data.sessionId || "unknown",
			status: response.status,
		};
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		ctx.logger.error("Error calling Devin API: %o", error);
		throw new Error(`Failed to call Devin API: ${errorMessage}`);
	}
}
