import type {
    RalphGrillAgentRole,
    RalphGrillAgentRunResult,
    RalphGrillCandidateQuestion,
    RalphGrillConsolidatedQuestion,
    RalphGrillConsolidationSummary,
    RalphGrillQuestionConsolidationResult,
    RalphGrillQuestionOption,
    RalphGrillQuestionSource,
} from './grill-planning-types';
import { AGENT_DEFINITIONS } from './grill-agent-config';

export const SEMANTIC_DUPLICATE_THRESHOLD = 0.67;
const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'be',
    'by',
    'can',
    'for',
    'from',
    'how',
    'is',
    'it',
    'of',
    'on',
    'or',
    'should',
    'the',
    'this',
    'to',
    'we',
    'what',
    'when',
    'where',
    'which',
    'who',
    'will',
    'with',
]);
const TOKEN_ALIASES = new Map<string, string>([
    ['audience', 'user'],
    ['audiences', 'user'],
    ['capabilities', 'feature'],
    ['capability', 'feature'],
    ['customer', 'user'],
    ['customers', 'user'],
    ['disable', 'disable'],
    ['disabled', 'disable'],
    ['disabling', 'disable'],
    ['enable', 'enable'],
    ['enabled', 'enable'],
    ['enabling', 'enable'],
    ['group', 'user'],
    ['groups', 'user'],
    ['people', 'user'],
    ['stakeholder', 'user'],
    ['stakeholders', 'user'],
    ['users', 'user'],
]);
const OPPOSING_TOKEN_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['enable', 'disable'],
    ['include', 'exclude'],
    ['required', 'optional'],
    ['automatic', 'manual'],
    ['allow', 'block'],
    ['persist', 'discard'],
];

export function emptyRalphGrillConsolidationSummary(): RalphGrillConsolidationSummary {
    return {
        rawCandidateCount: 0,
        selectedQuestionCount: 0,
        exactDuplicatesMerged: 0,
        semanticDuplicatesMerged: 0,
        conflictsConverted: 0,
        duplicateOnlyAgents: [],
    };
}

export function normalizeQuestionForExactMatch(question: string): string {
    return question
        .toLowerCase()
        .replace(/['"`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function normalizeQuestionToken(raw: string): string | undefined {
    let token = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!token || STOP_WORDS.has(token)) return undefined;
    token = TOKEN_ALIASES.get(token) ?? token;
    if (token.endsWith('ies') && token.length > 4) {
        token = `${token.slice(0, -3)}y`;
    } else if (token.endsWith('s') && token.length > 3) {
        token = token.slice(0, -1);
    }
    token = TOKEN_ALIASES.get(token) ?? token;
    return token && !STOP_WORDS.has(token) ? token : undefined;
}

export function questionTokenSet(question: string): Set<string> {
    const tokens = new Set<string>();
    for (const part of question.split(/[^a-zA-Z0-9]+/)) {
        const token = normalizeQuestionToken(part);
        if (token) tokens.add(token);
    }
    return tokens;
}

function sourceKey(source: RalphGrillQuestionSource): string {
    return [
        source.role,
        source.provider ?? '',
        source.model ?? '',
        source.effortTier ?? '',
        source.provenanceLabel,
    ].join('\u0000');
}

function mergeQuestionSources(
    left: RalphGrillQuestionSource[],
    right: RalphGrillQuestionSource[],
): RalphGrillQuestionSource[] {
    const merged = new Map<string, RalphGrillQuestionSource>();
    for (const source of [...left, ...right]) {
        merged.set(sourceKey(source), source);
    }
    return [...merged.values()];
}

function mergeRationales(left: string | undefined, right: string | undefined): string | undefined {
    const values = [left?.trim(), right?.trim()].filter((value): value is string => !!value);
    if (values.length === 0) return undefined;
    return [...new Set(values)].join(' ');
}

function optionSignature(question: RalphGrillCandidateQuestion): string | undefined {
    if (!question.options?.length) return undefined;
    return question.options
        .map(option => `${option.value.trim().toLowerCase()}:${option.label.trim().toLowerCase()}`)
        .sort()
        .join('|');
}

function defaultValueSignature(question: RalphGrillCandidateQuestion): string | undefined {
    const value = question.defaultValue;
    if (value === undefined) return undefined;
    return Array.isArray(value)
        ? value.map(item => item.trim().toLowerCase()).sort().join('|')
        : value.trim().toLowerCase();
}

function tokenOverlapSize(left: Set<string>, right: Set<string>, ignored = new Set<string>()): number {
    let count = 0;
    for (const token of left) {
        if (!ignored.has(token) && right.has(token)) count++;
    }
    return count;
}

export function tokenSimilarity(left: Set<string>, right: Set<string>): number {
    if (left.size === 0 || right.size === 0) return 0;
    const intersection = tokenOverlapSize(left, right);
    const union = new Set([...left, ...right]).size;
    return union === 0 ? 0 : intersection / union;
}

function findOpposingTokenPair(left: Set<string>, right: Set<string>): readonly [string, string] | undefined {
    return OPPOSING_TOKEN_PAIRS.find(([positive, negative]) =>
        (left.has(positive) && right.has(negative)) || (left.has(negative) && right.has(positive)));
}

function hasConflictingChoices(
    left: RalphGrillCandidateQuestion,
    right: RalphGrillCandidateQuestion,
    comparable: boolean,
): boolean {
    if (!comparable) return false;
    const leftOptions = optionSignature(left);
    const rightOptions = optionSignature(right);
    if (leftOptions && rightOptions && leftOptions !== rightOptions) {
        return true;
    }
    const leftDefault = defaultValueSignature(left);
    const rightDefault = defaultValueSignature(right);
    return !!leftDefault && !!rightDefault && leftDefault !== rightDefault;
}

function isConflictingQuestion(
    left: RalphGrillCandidateQuestion,
    right: RalphGrillCandidateQuestion,
    leftTokens: Set<string>,
    rightTokens: Set<string>,
    comparable: boolean,
): boolean {
    if (hasConflictingChoices(left, right, comparable)) {
        return true;
    }
    const opposingPair = findOpposingTokenPair(leftTokens, rightTokens);
    if (!opposingPair) return false;
    const ignored = new Set(opposingPair);
    return comparable || tokenOverlapSize(leftTokens, rightTokens, ignored) >= 1;
}

function slugifyOptionValue(label: string, index: number): string {
    const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return slug || `option-${index + 1}`;
}

function stripQuestionSuffix(question: string): string {
    return question.trim().replace(/[?.!]+$/g, '');
}

function uniqueOptions(options: RalphGrillQuestionOption[]): RalphGrillQuestionOption[] {
    const seen = new Set<string>();
    const unique: RalphGrillQuestionOption[] = [];
    for (const option of options) {
        const key = `${option.value.trim().toLowerCase()}:${option.label.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(option);
    }
    return unique;
}

function inferConflictOptions(
    left: RalphGrillCandidateQuestion,
    right: RalphGrillCandidateQuestion,
    leftTokens: Set<string>,
    rightTokens: Set<string>,
): RalphGrillQuestionOption[] {
    const opposingPair = findOpposingTokenPair(leftTokens, rightTokens);
    if (opposingPair?.[0] === 'enable' && opposingPair[1] === 'disable') {
        return [
            { value: 'enabled-by-default', label: 'Enable by default' },
            { value: 'disabled-by-default', label: 'Disable by default' },
        ];
    }

    const mergedOptions = uniqueOptions([...(left.options ?? []), ...(right.options ?? [])]);
    if (mergedOptions.length >= 2) {
        return mergedOptions.slice(0, 8);
    }

    return [left.question, right.question].map((question, index) => {
        const label = stripQuestionSuffix(question);
        return {
            value: slugifyOptionValue(label, index),
            label,
        };
    });
}

function inferConflictQuestion(
    left: RalphGrillCandidateQuestion,
    right: RalphGrillCandidateQuestion,
    leftTokens: Set<string>,
    rightTokens: Set<string>,
): string {
    const opposingPair = findOpposingTokenPair(leftTokens, rightTokens);
    if (opposingPair?.[0] === 'enable' && opposingPair[1] === 'disable' && (leftTokens.has('default') || rightTokens.has('default'))) {
        return 'Should this capability be enabled or disabled by default?';
    }
    if ((left.options?.length ?? 0) > 0 || (right.options?.length ?? 0) > 0) {
        return left.question;
    }
    return `Resolve this conflicting clarification decision: ${stripQuestionSuffix(left.question)}.`;
}

type ConsolidationRelation = 'exact-duplicate' | 'semantic-duplicate' | 'conflict';
type DuplicateConsolidationRelation = Exclude<ConsolidationRelation, 'conflict'>;

interface RalphGrillConsolidationGroup {
    question: RalphGrillConsolidatedQuestion;
    exactKeys: Set<string>;
    tokens: Set<string>;
}

interface RalphGrillAskedQuestionIndex {
    exactKey: string;
    tokens: Set<string>;
}

function toConsolidatedQuestion(question: RalphGrillCandidateQuestion): RalphGrillConsolidatedQuestion {
    return {
        ...question,
        sources: mergeQuestionSources(question.sources, []),
        consolidation: {
            kind: 'unique',
            mergedCandidateCount: 1,
            mergedQuestions: [question.question],
        },
    };
}

function classifyQuestionRelation(
    group: RalphGrillConsolidationGroup,
    question: RalphGrillCandidateQuestion,
    questionExactKey: string,
    questionTokens: Set<string>,
): ConsolidationRelation | undefined {
    const duplicateRelation = classifyDuplicateQuestionRelation(group.exactKeys, group.tokens, questionExactKey, questionTokens);
    const comparable = !!duplicateRelation;
    if (isConflictingQuestion(group.question, question, group.tokens, questionTokens, comparable)) {
        return 'conflict';
    }
    if (duplicateRelation) return duplicateRelation;
    return undefined;
}

function classifyDuplicateQuestionRelation(
    exactKeys: Set<string>,
    tokens: Set<string>,
    questionExactKey: string,
    questionTokens: Set<string>,
): DuplicateConsolidationRelation | undefined {
    if (exactKeys.has(questionExactKey)) return 'exact-duplicate';
    if (tokenSimilarity(tokens, questionTokens) >= SEMANTIC_DUPLICATE_THRESHOLD) {
        return 'semantic-duplicate';
    }
    return undefined;
}

function buildAlreadyAskedQuestionIndex(questions: string[]): RalphGrillAskedQuestionIndex[] {
    return questions
        .map(question => ({
            exactKey: normalizeQuestionForExactMatch(question),
            tokens: questionTokenSet(question),
        }))
        .filter(index => index.exactKey.length > 0 || index.tokens.size > 0);
}

function findAlreadyAskedDuplicateRelation(
    alreadyAsked: RalphGrillAskedQuestionIndex[],
    questionExactKey: string,
    questionTokens: Set<string>,
): DuplicateConsolidationRelation | undefined {
    for (const asked of alreadyAsked) {
        const relation = classifyDuplicateQuestionRelation(new Set([asked.exactKey]), asked.tokens, questionExactKey, questionTokens);
        if (relation) return relation;
    }
    return undefined;
}

function mergeQuestionIntoGroup(
    group: RalphGrillConsolidationGroup,
    question: RalphGrillCandidateQuestion,
    relation: ConsolidationRelation,
    questionExactKey: string,
    questionTokens: Set<string>,
): void {
    const mergedSources = mergeQuestionSources(group.question.sources, question.sources);
    const mergedQuestions = [...new Set([...group.question.consolidation.mergedQuestions, question.question])];
    const mergedCandidateCount = group.question.consolidation.mergedCandidateCount + 1;
    if (relation === 'conflict') {
        const options = inferConflictOptions(group.question, question, group.tokens, questionTokens);
        group.question = {
            question: inferConflictQuestion(group.question, question, group.tokens, questionTokens),
            type: 'select',
            options,
            rationale: mergeRationales(
                group.question.rationale,
                question.rationale ?? 'Conflicting candidate questions were converted into one user-facing decision.',
            ),
            sources: mergedSources,
            consolidation: {
                kind: 'converted-conflict',
                mergedCandidateCount,
                mergedQuestions,
            },
        };
    } else {
        group.question = {
            ...group.question,
            rationale: mergeRationales(group.question.rationale, question.rationale),
            sources: mergedSources,
            consolidation: {
                kind: 'merged-duplicate',
                mergedCandidateCount,
                mergedQuestions,
            },
        };
    }

    group.exactKeys.add(questionExactKey);
    for (const token of questionTokens) {
        group.tokens.add(token);
    }
}

function recordRoleContribution(
    contributions: Map<RalphGrillAgentRole, { total: number; productive: number }>,
    question: RalphGrillCandidateQuestion,
    productive: boolean,
): void {
    for (const source of question.sources) {
        const current = contributions.get(source.role) ?? { total: 0, productive: 0 };
        current.total += 1;
        if (productive) current.productive += 1;
        contributions.set(source.role, current);
    }
}

export function consolidateRalphGrillCandidateQuestions(
    candidateQuestions: RalphGrillCandidateQuestion[],
    agentResults: RalphGrillAgentRunResult[] = [],
    alreadyAskedQuestions: string[] = [],
): RalphGrillQuestionConsolidationResult {
    const groups: RalphGrillConsolidationGroup[] = [];
    const alreadyAsked = buildAlreadyAskedQuestionIndex(alreadyAskedQuestions);
    const contributions = new Map<RalphGrillAgentRole, { total: number; productive: number }>();
    let exactDuplicatesMerged = 0;
    let semanticDuplicatesMerged = 0;
    let conflictsConverted = 0;

    for (const question of candidateQuestions) {
        const questionExactKey = normalizeQuestionForExactMatch(question.question);
        const questionTokens = questionTokenSet(question.question);
        const alreadyAskedRelation = findAlreadyAskedDuplicateRelation(alreadyAsked, questionExactKey, questionTokens);
        if (alreadyAskedRelation) {
            if (alreadyAskedRelation === 'exact-duplicate') exactDuplicatesMerged += 1;
            if (alreadyAskedRelation === 'semantic-duplicate') semanticDuplicatesMerged += 1;
            recordRoleContribution(contributions, question, false);
            continue;
        }

        let matched = false;
        for (const group of groups) {
            const relation = classifyQuestionRelation(group, question, questionExactKey, questionTokens);
            if (!relation) continue;
            mergeQuestionIntoGroup(group, question, relation, questionExactKey, questionTokens);
            if (relation === 'exact-duplicate') exactDuplicatesMerged += 1;
            if (relation === 'semantic-duplicate') semanticDuplicatesMerged += 1;
            if (relation === 'conflict') conflictsConverted += 1;
            recordRoleContribution(contributions, question, relation === 'conflict');
            matched = true;
            break;
        }
        if (matched) continue;

        groups.push({
            question: toConsolidatedQuestion(question),
            exactKeys: new Set([questionExactKey]),
            tokens: new Set(questionTokens),
        });
        recordRoleContribution(contributions, question, true);
    }

    const duplicateOnlyAgents = agentResults.length > 0
        ? agentResults
            .filter(result => result.questions.length > 0)
            .filter(result => {
                const contribution = contributions.get(result.agent.role);
                return contribution && contribution.total > 0 && contribution.productive === 0;
            })
            .map(result => result.agent.label)
        : [...contributions.entries()]
            .filter(([, contribution]) => contribution.total > 0 && contribution.productive === 0)
            .map(([role]) => AGENT_DEFINITIONS[role].label);

    const warnings = duplicateOnlyAgents.map(agentLabel =>
        `${agentLabel} contributed only duplicate candidate questions after consolidation.`);

    const selectedQuestions = groups.map(group => group.question);
    return {
        selectedQuestions,
        summary: {
            rawCandidateCount: candidateQuestions.length,
            selectedQuestionCount: selectedQuestions.length,
            exactDuplicatesMerged,
            semanticDuplicatesMerged,
            conflictsConverted,
            duplicateOnlyAgents,
        },
        warnings,
    };
}
