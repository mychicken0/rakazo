import { Trans, useLingui } from "@lingui/react/macro";
import type { LoginFieldInput } from "@rakazo/contracts";
import { Button, Input, Label, Switch } from "@rakazo/ui-web";
import { useId, useState } from "react";
import { pastedFieldValues } from "./vault/LoginFieldsInput";

/**
 * A login asked for in chat, typed or pasted right in the card: often just one field, such as a
 * password. Save to Vault starts as the bot suggested; off, the login is used for this run only.
 * The values live only in this form until they are sent.
 */
export function InlineLoginForm({
  fields: initial,
  remember: suggested,
  disabled,
  onSubmit,
  onDismiss,
}: {
  fields: readonly LoginFieldInput[];
  remember: boolean;
  disabled: boolean;
  onSubmit: (fields: LoginFieldInput[], remember: boolean) => Promise<void>;
  onDismiss?: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const [values, setValues] = useState(() => initial.map(() => ""));
  const [remember, setRemember] = useState(suggested);
  const ready = values.every((value, index) =>
    initial[index]?.hidden ? value.length > 0 : value.trim().length > 0,
  );

  return (
    <form
      className="mt-3 flex flex-col gap-2"
      data-testid="inline-login-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || disabled) return;
        const fields = initial.map((field, index) => ({ ...field, value: values[index] ?? "" }));
        setValues(initial.map(() => ""));
        void onSubmit(fields, remember);
      }}
    >
      {initial.map((field, index) => (
        <Input
          key={field.label}
          aria-label={field.label}
          placeholder={field.label}
          type={field.hidden ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={values[index] ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setValues((current) => current.map((old, i) => (i === index ? value : old)));
          }}
          onPaste={(event) => {
            // A username and password pasted together, one per line, fill the fields in order.
            const lines = pastedFieldValues(
              event.clipboardData.getData("text/plain"),
              initial.length - index,
            );
            if (!lines) return;
            event.preventDefault();
            setValues((current) =>
              current.map((old, i) =>
                i >= index && i < index + lines.length ? lines[i - index]! : old,
              ),
            );
          }}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Switch
          id={`${id}-remember`}
          size="sm"
          checked={remember}
          disabled={disabled}
          onCheckedChange={setRemember}
        />
        <Label
          htmlFor={`${id}-remember`}
          className="text-body-sm font-normal text-muted-foreground"
        >
          <Trans>Save to Vault</Trans>
        </Label>
        <span className="flex-1" />
        {onDismiss ? (
          <Button type="button" variant="outline" disabled={disabled} onClick={onDismiss}>
            <Trans>Dismiss</Trans>
          </Button>
        ) : null}
        <Button type="submit" data-testid="inline-login-submit" disabled={!ready || disabled}>
          {remember ? t`Save` : t`Continue`}
        </Button>
      </div>
    </form>
  );
}
