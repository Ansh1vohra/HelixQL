import type { AgentTurnRequest, AgentTurnResult, ChatTurn, PipelineResult, PriorExchange } from "../shared/types";
import { getBlueprint, requireActive } from "./db/connection";
import { matchSchemaQuestion } from "./db/schemaQuestion";
import { AppError } from "./errors";
import * as gateway from "./gateway";
import { type Emit, runPipeline, selectSchema } from "./pipeline";

/**
 * Agent talk: a short conversation that pins down an ambiguous question
 * before any SQL is written.
 *
 * "Who is our best customer?" can mean most orders or highest spend. Rather
 * than let the translator guess, the model asks — but only about readings
 * the connected schema can actually answer. That grounding comes from
 * sending the clarifier the same pruned blueprint the translator would get,
 * so it cannot offer "highest spend" to a database with no amount column,
 * and it can say up front when the data isn't there at all.
 *
 * Stateless by design: the renderer holds the conversation and sends it
 * whole each turn. It is prose the user typed and the model wrote — nothing
 * here is sensitive, and no row data is ever part of it.
 *
 * Clarification is advisory, like schema linking. If the clarifier is
 * unreachable or confused, the turn falls through to an ordinary run on
 * what the user has said so far, which is exactly what the one-shot mode
 * would have done.
 */

/** How many earlier questions a follow-up is read against. The latest one
 * or two carry the thread; older ones mostly add noise to table selection. */
const CONTEXT_WINDOW = 3;

/** Same shape as the gateway's fallback, so a question assembled on either
 * side reads the same to the translator. */
export function fallbackQuestion(question: string, history: ChatTurn[], context: PriorExchange[] = []): string {
  const answers = history
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.trim())
    .filter(Boolean);
  let text = answers.length === 0 ? question.trim() : `${question.trim()} (${answers.join("; ")})`;
  // On its own, "do we have email for all?" has no subject.
  const previous = context[context.length - 1];
  if (previous) text = `${text} (follow-up to: ${previous.resolvedQuestion.trim()})`;
  return text;
}

/** Text used to pick tables mid-conversation. The replies matter as much as
 * the question: "by region" can pull in a table the question never named.
 * So does the previous question: "do we have email for all?" names no table
 * at all, and "all" means the customers asked about a moment ago. */
function selectionText(question: string, history: ChatTurn[], context: PriorExchange[]): string {
  const previous = context[context.length - 1];
  return [
    ...(previous ? [previous.resolvedQuestion] : []),
    question,
    ...history.filter((turn) => turn.role === "user").map((turn) => turn.content),
  ].join(". ");
}

async function answer(
  resolvedQuestion: string,
  assumptions: string[],
  emit: Emit,
): Promise<AgentTurnResult> {
  // Tables are re-selected for the resolved question: it is what the
  // translator reads, so it is what the blueprint should be chosen for.
  const result: PipelineResult = await runPipeline({ question: resolvedQuestion }, emit);
  return { kind: "answer", resolvedQuestion, assumptions, result };
}

export async function runAgentTurn(request: AgentTurnRequest, emit: Emit): Promise<AgentTurnResult> {
  const question = request.question.trim();
  if (!question) {
    throw new AppError("EMPTY_QUESTION", "Type a question first.");
  }

  const history = request.history.filter((turn) => turn.content.trim());
  const context = (request.context ?? [])
    .filter((prior) => prior.question.trim() && prior.resolvedQuestion.trim())
    .slice(-CONTEXT_WINDOW);

  if (request.skip) {
    return answer(fallbackQuestion(question, history, context), [], emit);
  }

  // Fails fast with the usual "connect first" error before any network call.
  requireActive();
  const blueprint = getBlueprint();

  // Nothing to clarify in "show the columns of users": the pipeline answers
  // it from the local schema without a model call.
  if (history.length === 0 && matchSchemaQuestion(question, blueprint)) {
    return answer(question, [], emit);
  }

  emit({ step: "pruning", message: "Reading the schema for your question…" });
  const selection = await selectSchema(blueprint, selectionText(question, history, context));

  emit({
    step: "clarifying",
    message: "Checking whether anything needs clarifying…",
    detail: selection.tables.join(", "),
  });

  let reply: gateway.ClarifyResponse;
  try {
    reply = await gateway.clarify(question, selection.schemaDdl, history, context);
  } catch {
    // Swallowed by design. A real fault (expired token, spent quota)
    // resurfaces from the translate call with its proper code; anything
    // else was only the clarifier, and the question can still be answered.
    return answer(fallbackQuestion(question, history, context), [], emit);
  }

  if (reply.status === "ask" && reply.message) {
    return { kind: "ask", message: reply.message, options: reply.options };
  }

  if (reply.status === "unanswerable") {
    return { kind: "unanswerable", message: reply.message };
  }

  return answer(
    reply.resolved_question?.trim() || fallbackQuestion(question, history, context),
    reply.assumptions,
    emit,
  );
}
