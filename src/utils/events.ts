import type { AgentContext } from "@agentuity/sdk";

/**
 * Generate a unique key for tracking processed events
 * @param repositoryName The name of the repository
 * @param version The version of the release/tag
 * @param eventType The type of event (release or tag)
 * @returns A unique key for the KV store
 */
export function generateEventKey(repositoryName: string, version: string, eventType: string): string {
	return `changelog-event:${repositoryName}:${version}:${eventType}`;
}
