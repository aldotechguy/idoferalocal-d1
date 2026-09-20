import { writeFileSync } from 'node:fs';
const msg = [
  'chore: drop temporary checkout-drill and commit-msg artifacts',
  '',
  '- Remove NODEJS_OUT.TXT and NODEJS_ERR.TXT leftover from the live',
  '  customer-copy checkout drill against idomall.olz.workers.dev.',
  '- Remove .git-commit-msg.txt used only for authoring this branch.',
  '- Stage the deletions so the tree stays clean before push.',
  ''
].join('\n');
writeFileSync('.git-commit-msg.txt', msg, 'utf8');
console.log('COMMIT_MSG_WRITTEN');
