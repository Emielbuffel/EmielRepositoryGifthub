import test from 'node:test';
import assert from 'node:assert/strict';
import { brief, firstSentence } from '../src/core/brief.js';

test('one short sentence about the company', () => {
  assert.equal(brief('UCB SA, a biopharmaceutical company, develops products and solutions for people with neurology and immunology diseases worldwide. The company offers Cimzia for the treatment of Crohn\'s disease.', 'UCB SA'),
    'A biopharmaceutical company: develops products and solutions for people with neurology and immunology diseases.');
  assert.equal(brief('NVIDIA Corporation, a computing infrastructure company, provides graphics and compute and networking solutions in the United States, Singapore, Taiwan, China, Hong Kong, and internationally. The company operates through two segments.', 'NVIDIA Corporation').startsWith('A computing infrastructure company: provides graphics'), true);
  assert.equal(firstSentence('ASML Holding N.V. develops lithography systems. It was founded in 1984.'), 'ASML Holding N.V. develops lithography systems.');
  const s = brief('Siemens Energy AG operates as an energy technology company worldwide. It operates through Gas Services, Grid Technologies segments.', 'Siemens Energy AG');
  assert.equal(s, 'Operates as an energy technology company.');
  assert.ok(brief('X'.repeat(10) + ' ' + 'word '.repeat(80) + '.').length <= 151);
});
