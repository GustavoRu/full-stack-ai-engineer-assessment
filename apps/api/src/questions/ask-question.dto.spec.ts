import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AskQuestionDto } from './ask-question.dto.js';

const errorsFor = (body: object) => validate(plainToInstance(AskQuestionDto, body));

describe('AskQuestionDto', () => {
  it('accepts a question with no mode, or with a known mode', async () => {
    expect(await errorsFor({ question: 'Hi?' })).toEqual([]);
    expect(await errorsFor({ question: 'Hi?', mode: 'classic' })).toEqual([]);
    expect(await errorsFor({ question: 'Hi?', mode: 'agentic' })).toEqual([]);
  });

  it('rejects an unknown mode', async () => {
    const errors = await errorsFor({ question: 'Hi?', mode: 'turbo' });
    expect(errors.map((error) => error.property)).toEqual(['mode']);
  });
});
