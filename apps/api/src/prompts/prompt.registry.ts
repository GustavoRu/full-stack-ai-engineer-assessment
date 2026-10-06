import type { PromptTemplate } from './prompt.types.js';
import { qaV1 } from './qa-v1.js';

const TEMPLATES = new Map<string, PromptTemplate>([[qaV1.version, qaV1]]);

export function getPromptTemplate(version: string): PromptTemplate {
  const template = TEMPLATES.get(version);
  if (!template) {
    throw new Error(`Unknown prompt version "${version}". Available: ${[...TEMPLATES.keys()].join(', ')}`);
  }
  return template;
}
