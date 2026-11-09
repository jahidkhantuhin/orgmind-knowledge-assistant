import { createHash } from 'node:crypto';

export type EvaluationDocument = {
  key: string;
  name: string;
  text: string;
};

export type GoldenCase = {
  id: string;
  question: string;
  expectedAnswer: string;
  expectedSourceKeys: string[];
};

export const evaluationDocuments: EvaluationDocument[] = [
  {
    key: 'employee-handbook',
    name: 'OrgMind Evaluation - Employee Handbook.md',
    text: `# Leave policies

## Sick leave
Every employee receives 10 paid sick days per year. Tell your manager before your shift starts, or as soon as you are able. A doctor's note is required after three consecutive sick days. Unused sick days do not carry over.

## Parental leave
The primary caregiver receives 16 weeks of fully paid parental leave. The secondary caregiver receives 6 weeks of fully paid parental leave. Contact People Operations to arrange leave.`,
  },
  {
    key: 'it-access-policy',
    name: 'OrgMind Evaluation - IT Access Policy.md',
    text: `# Account security

## Sign-in protection
An account is temporarily locked after five consecutive failed sign-in attempts. The lock lasts 15 minutes. Employees can use the password reset page while the account is locked.

## Password requirements
Passwords must contain at least 12 characters. Contact the service desk if you cannot access the password reset page.`,
  },
];

export const goldenDataset: GoldenCase[] = [
  {
    id: 'sick-leave-allowance',
    question: 'How many paid sick days do employees get, and when is a doctor note required?',
    expectedAnswer:
      'Employees receive 10 paid sick days each year. A doctor note is required after three consecutive sick days.',
    expectedSourceKeys: ['employee-handbook'],
  },
  {
    id: 'parental-leave',
    question: 'How much paid parental leave does each caregiver receive?',
    expectedAnswer:
      'The primary caregiver gets 16 fully paid weeks, and the secondary caregiver gets 6 fully paid weeks.',
    expectedSourceKeys: ['employee-handbook'],
  },
  {
    id: 'account-lockout',
    question: 'How many failed sign-in attempts lock an account, and how long does the lock last?',
    expectedAnswer: 'Five consecutive failed sign-in attempts lock an account for 15 minutes.',
    expectedSourceKeys: ['it-access-policy'],
  },
];

export function evaluationDocumentId(organizationId: string, key: string): string {
  const hex = createHash('sha256').update(`${organizationId}:orgmind-eval:${key}`).digest('hex');
  const chars = hex.slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = chars.join('');
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}
