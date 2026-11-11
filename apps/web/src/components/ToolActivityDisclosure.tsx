import { Plural, Trans } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { ThreadMessage } from "@rakazo/contracts";
import { formatCompactDuration } from "@rakazo/core";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment } from "react";
import { toolStepCount } from "../lib/tool-activity-view";
import type {
  ToolCall,
  ToolCallField,
  ToolCallOutput as ToolCallOutputView,
} from "../lib/tool-call-view";
import { formatCallDuration, toolCallView } from "../lib/tool-call-view";

type ToolStep = Extract<ThreadMessage["blocks"][number], { kind: "steps" }>["steps"][number];

/** While a run is live, only the most recent steps are listed so a long run does not push the chat down. */
export const LIVE_TOOL_STEP_WINDOW = 6;

export function ToolSteps({
  steps,
  currentIndex,
  limit,
}: {
  steps: readonly ToolStep[];
  currentIndex?: number;
  /** Show only the last `limit` steps, with a count of the earlier ones above them. */
  limit?: number;
}) {
  const hidden = limit !== undefined && steps.length > limit ? steps.length - limit : 0;
  const shown = hidden > 0 ? steps.slice(hidden) : steps;
  return (
    <div className="space-y-0.5" data-testid="tool-rows">
      {hidden > 0 ? (
        <div className="text-label leading-5 text-muted-foreground" data-testid="tool-rows-hidden">
          <Plural value={hidden} one="+# earlier step" other="+# earlier steps" />
        </div>
      ) : null}
      {shown.map((step, offset) => {
        const index = hidden + offset;
        const isCurrent = index === currentIndex;
        return (
          <Fragment key={index}>
            {step.note ? (
              <div className="py-1 text-body-sm text-foreground/75" data-testid="tool-step-note">
                <ChatMarkdown>{step.note}</ChatMarkdown>
              </div>
            ) : null}
            <div className="flex min-w-0 items-center gap-2 leading-5">
              <span
                className={`text-label ${isCurrent ? "text-warning" : "text-success"}`}
                style={{ animation: isCurrent ? "rkPulse 1.2s ease-in-out infinite" : undefined }}
              >
                {isCurrent ? "◷" : "✓"}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-body-sm ${
                  isCurrent ? "text-foreground" : "text-muted-foreground"
                }`}
                title={step.label}
              >
                {step.label}
                {step.count > 1 ? ` ×${step.count}` : ""}
              </span>
            </div>
            <ToolStepDetails step={step} />
          </Fragment>
        );
      })}
    </div>
  );
}

/** The reasoning summary, or each call's input and output, folded under its step. */
function ToolStepDetails({ step }: { step: ToolStep }) {
  if (step.thinking) {
    if (!step.text) return null;
    return (
      <div className="ms-5 mb-1">
        <DetailDisclosure summary={<Trans>Reasoning</Trans>}>
          <div className="text-body-sm text-foreground/80">
            <ChatMarkdown>{step.text}</ChatMarkdown>
          </div>
        </DetailDisclosure>
      </div>
    );
  }
  const calls = (step.calls ?? []).filter(
    (call) => call.input !== undefined || call.output !== undefined,
  );
  if (calls.length === 0) return null;
  return (
    <div className="ms-5 mb-1 space-y-0.5">
      {calls.map((call, index) => (
        <ToolCallRow key={index} call={call} />
      ))}
    </div>
  );
}

function DetailDisclosure({
  summary,
  aside,
  children,
}: {
  summary: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible data-testid="tool-step-detail" className="group/detail min-w-0">
      <CollapsibleTrigger className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left text-label text-muted-foreground outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          aria-hidden
          size={12}
          strokeWidth={1.8}
          className="shrink-0 transition-transform duration-150 group-data-panel-open/detail:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {aside}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 mb-2 space-y-2 rounded-md border border-border bg-muted/40 p-2.5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const codeBlock =
  "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1.5 font-mono text-label leading-5 text-foreground/85";

function ToolCallRow({ call }: { call: ToolCall }) {
  const view = toolCallView(call);
  const failed =
    call.error === true ||
    (view.output?.kind === "shell" &&
      view.output.exitCode !== undefined &&
      view.output.exitCode !== 0);
  const duration = formatCallDuration(call.durationMs);
  return (
    <DetailDisclosure
      summary={
        view.summary ? (
          <span className="font-mono">{view.summary}</span>
        ) : (
          <Trans>Input and output</Trans>
        )
      }
      aside={
        <span className="flex shrink-0 items-center gap-1.5">
          {failed ? (
            <span className="text-destructive">
              <Trans>failed</Trans>
            </span>
          ) : null}
          {duration ? <span>{duration}</span> : null}
        </span>
      }
    >
      {view.command ? (
        <div className="space-y-1">
          {view.cwd ? (
            <div className="truncate font-mono text-label text-muted-foreground">{view.cwd}</div>
          ) : null}
          <pre className={codeBlock}>
            <span className="select-none text-muted-foreground">$ </span>
            {view.command}
          </pre>
        </div>
      ) : null}
      {view.fields.length > 0 ? <FieldList fields={view.fields} /> : null}
      {view.output ? <CallOutput output={view.output} error={call.error === true} /> : null}
    </DetailDisclosure>
  );
}

function FieldList({ fields }: { fields: readonly ToolCallField[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-label">
      {fields.map((item) => (
        <Fragment key={item.key}>
          <dt className="pt-0.5 text-muted-foreground">{item.key}</dt>
          <dd className="min-w-0">
            {item.code ? (
              <pre className={codeBlock}>{item.value}</pre>
            ) : (
              <span className="whitespace-pre-wrap break-words text-foreground/85">
                {item.value}
              </span>
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function CallOutput({ output, error }: { output: ToolCallOutputView; error: boolean }) {
  const label = (
    <div className={`text-label ${error ? "text-destructive" : "text-muted-foreground"}`}>
      {error ? <Trans>Error</Trans> : <Trans>Output</Trans>}
    </div>
  );
  if (output.kind === "fields") {
    return (
      <div className="space-y-1">
        {label}
        <FieldList fields={output.fields} />
      </div>
    );
  }
  if (output.kind === "text") {
    return (
      <div className="space-y-1">
        {label}
        {output.text ? (
          <pre className={codeBlock}>{output.text}</pre>
        ) : (
          <div className="text-label text-muted-foreground">
            <Trans>No output</Trans>
          </div>
        )}
      </div>
    );
  }
  const failedExit = output.exitCode !== undefined && output.exitCode !== 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {label}
        {failedExit ? (
          <span className="text-label text-destructive">
            <Trans>exit code {output.exitCode}</Trans>
          </span>
        ) : null}
      </div>
      {output.stdout ? (
        <pre className={codeBlock}>{output.stdout.replace(/\n$/, "")}</pre>
      ) : !output.stderr ? (
        <div className="text-label text-muted-foreground">
          <Trans>No output</Trans>
        </div>
      ) : null}
      {output.stderr ? (
        <pre className={`${codeBlock} text-destructive`}>{output.stderr.replace(/\n$/, "")}</pre>
      ) : null}
    </div>
  );
}

/**
 * The tool-activity card. It starts open while the run is live and folds when the run
 * ends. The keyed default keeps manual toggles until the run changes phase.
 */
export function ToolActivityDisclosure({
  live,
  stepCount,
  durationMs,
  children,
}: {
  live: boolean;
  stepCount: number;
  durationMs?: number;
  children: ReactNode;
}) {
  const duration = formatCompactDuration(durationMs);
  const toolCount = stepCount;
  return (
    <Collapsible
      key={live ? "working" : "actions"}
      defaultOpen={live}
      data-testid="tool-activity"
      data-live={live || undefined}
      className="group"
    >
      <CollapsibleTrigger
        className={`flex min-h-6 w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 pe-1.5 text-body-sm font-medium outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          live ? "text-foreground/75" : "text-muted-foreground"
        }`}
      >
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className="transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="flex items-center gap-2">
          <span>{live ? <Trans>Working…</Trans> : <Trans>Done</Trans>}</span>
          <span>
            <Plural value={toolCount} one="# tool" other="# tools" />
          </span>
          {!live && duration ? <span>{duration}</span> : null}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent hiddenUntilFound>
        <div className="ms-[7px] mt-0.5 border-s border-border ps-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A tools-only message: a plain muted line between messages, not a chat bubble.
 */
export function StandaloneToolActivity({
  live,
  steps,
  stepCount,
  durationMs,
}: {
  live: boolean;
  steps: readonly ToolStep[];
  stepCount: number;
  durationMs?: number;
}) {
  return (
    <div className="flex justify-start" dir="ltr" data-testid="tool-activity-line">
      <div className="max-w-full min-w-0 ps-1">
        <ToolActivityDisclosure live={live} stepCount={stepCount} durationMs={durationMs}>
          <ToolSteps
            steps={steps}
            currentIndex={live ? steps.length - 1 : undefined}
            limit={live ? LIVE_TOOL_STEP_WINDOW : undefined}
          />
        </ToolActivityDisclosure>
      </div>
    </div>
  );
}

/** A bot message whose only visible blocks are tool cards: one slim line per card, no bubble. */
export function ToolOnlyNarration({
  blocks,
  live,
}: {
  blocks: readonly ThreadMessage["blocks"][number][];
  live: boolean;
}) {
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === "steps" ? (
          <StandaloneToolActivity
            key={i}
            live={live}
            steps={block.steps}
            stepCount={toolStepCount(block.steps)}
            durationMs={block.durationMs}
          />
        ) : null,
      )}
    </>
  );
}
