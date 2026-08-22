import type {
    RalphGrillCandidateQuestion,
    RalphGrillQuestionOption,
    RalphGrillQuestionSource,
    RalphGrillQuestionType,
    ResolvedRalphGrillAgent,
} from './grill-planning-types';

export const MAX_QUESTIONS_PER_AGENT = 6;
const QUESTION_TYPES = new Set<RalphGrillQuestionType>(['select', 'multi-select', 'yes-no', 'confirm', 'text']);

function stripCodeFences(raw: string): string {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
    return fenced ? fenced[1].trim() : trimmed;
}

export function sourceFor(agent: ResolvedRalphGrillAgent): RalphGrillQuestionSource {
    return {
        role: agent.role,
        roleLabel: agent.label,
        ...(agent.provider ? { provider: agent.provider } : {}),
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.effortTier ? { effortTier: agent.effortTier } : {}),
        provenanceLabel: agent.provenanceLabel,
    };
}

function sanitizeOptions(raw: unknown): RalphGrillQuestionOption[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const options = raw
        .map((option): RalphGrillQuestionOption | undefined => {
            if (!option || typeof option !== 'object') {
                return undefined;
            }
            const record = option as Record<string, unknown>;
            const value = typeof record.value === 'string' ? record.value.trim() : '';
            const label = typeof record.label === 'string' ? record.label.trim() : '';
            const description = typeof record.description === 'string' ? record.description.trim() : '';
            if (!value || !label) {
                return undefined;
            }
            return {
                value,
                label,
                ...(description ? { description } : {}),
            };
        })
        .filter((option): option is RalphGrillQuestionOption => !!option)
        .slice(0, 8);
    return options.length > 0 ? options : undefined;
}

function sanitizeDefaultValue(raw: unknown): string | string[] | undefined {
    if (typeof raw === 'string') {
        const value = raw.trim();
        return value || undefined;
    }
    if (Array.isArray(raw)) {
        const values = raw
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim())
            .filter(Boolean);
        return values.length > 0 ? values : undefined;
    }
    return undefined;
}

export function parseRalphGrillAgentResponse(raw: string, agent: ResolvedRalphGrillAgent): RalphGrillCandidateQuestion[] {
    const jsonText = stripCodeFences(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error(`AI returned non-JSON Ralph grill questions: ${raw.slice(0, 200)}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('AI Ralph grill question response must be a JSON object');
    }

    const rawQuestions = (parsed as { questions?: unknown }).questions;
    if (!Array.isArray(rawQuestions)) {
        throw new Error('AI Ralph grill question response must include a questions array');
    }

    const source = sourceFor(agent);
    return rawQuestions
        .map((item): RalphGrillCandidateQuestion | undefined => {
            if (!item || typeof item !== 'object') {
                return undefined;
            }
            const record = item as Record<string, unknown>;
            const question = typeof record.question === 'string' ? record.question.trim() : '';
            if (!question) {
                return undefined;
            }
            const rawType = typeof record.type === 'string' && QUESTION_TYPES.has(record.type as RalphGrillQuestionType)
                ? record.type as RalphGrillQuestionType
                : 'text';
            const options = sanitizeOptions(record.options);
            const defaultValue = sanitizeDefaultValue(record.defaultValue);
            const rationale = typeof record.rationale === 'string' ? record.rationale.trim() : '';
            return {
                question,
                type: rawType,
                ...(options ? { options } : {}),
                ...(defaultValue !== undefined ? { defaultValue } : {}),
                ...(rationale ? { rationale } : {}),
                sources: [source],
            };
        })
        .filter((question): question is RalphGrillCandidateQuestion => !!question)
        .slice(0, MAX_QUESTIONS_PER_AGENT);
}
