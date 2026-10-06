import { agentV1 } from './agent-v1.js';
import type { AgentPromptTemplate, PromptTemplate } from './prompt.types.js';
import { qaV1 } from './qa-v1.js';

const TEMPLATES = new Map<string, PromptTemplate>([[qaV1.version, qaV1]]);
const AGENT_TEMPLATES = new Map<string, AgentPromptTemplate>([[agentV1.version, agentV1]]);

export function getPromptTemplate(version: string): PromptTemplate {
  const template = TEMPLATES.get(version);
  if (!template) {
    throw new Error(`Unknown prompt version "${version}". Available: ${[...TEMPLATES.keys()].join(', ')}`);
  }
  return template;
}

export function getAgentPromptTemplate(version: string): AgentPromptTemplate {
  const template = AGENT_TEMPLATES.get(version);
  if (!template) {
    throw new Error(`Unknown agent prompt version "${version}". Available: ${[...AGENT_TEMPLATES.keys()].join(', ')}`);
  }
  return template;
}
