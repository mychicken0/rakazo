import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
import { canonicalPiProviderId } from "@rakazo/contracts";
import { modelCatalogSearchText } from "@rakazo/core";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  ListSearchInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo/ui-web";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";
import { useListSearch } from "../../lib/use-list-search";
import { errorText } from "../../lib/user-error";

/** Which of a connection's provider's models the pickers list. Display only; empty shows all. */
export function ShownModelsField({
  credential,
  catalog,
  onSaved,
}: {
  credential: ModelCredential;
  catalog: readonly ModelCatalogEntry[];
  onSaved: () => void;
}) {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const provider = canonicalPiProviderId(credential.provider);
  const models = useMemo(
    () =>
      catalog.filter(
        (entry) =>
          canonicalPiProviderId(entry.provider) === provider &&
          entry.protocol !== "decisions" &&
          !entry.placeholder &&
          !entry.managed,
      ),
    [catalog, provider],
  );
  const saved = credential.shownModelIds;
  const [shown, setShown] = useState<string[]>(saved ?? []);
  useEffect(() => setShown(saved ?? []), [saved]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { query, setQuery, showSearch, visible } = useListSearch(models, {
    text: modelCatalogSearchText,
  });
  if (models.length < 2) return null;

  const all = shown.length === 0;
  const checked = (id: string) => all || shown.includes(id);
  const save = (next: string[]) => {
    const before = shown;
    setShown(next);
    setError(null);
    rpc.models
      .setShownModels({ credentialId: credential.id, modelIds: next })
      .then(onSaved, (err: unknown) => {
        setShown(before);
        setError(errorText(err, t`Could not save models`));
      });
  };
  const toggle = (id: string) => {
    const current = all ? models.map((entry) => entry.id) : shown;
    if (!checked(id)) return save([...current, id]);
    // The last model stays: an empty list would show every model again.
    if (current.length === 1) return;
    const next = current.filter((entry) => entry !== id);
    save(next.length === models.length ? [] : next);
  };
  const count = shown.filter((id) => models.some((entry) => entry.id === id)).length;
  const total = models.length;
  const summary = all || count === 0 ? t`All models` : t`${count} of ${total} shown`;

  return (
    <div className="mb-6">
      <span className="block text-body text-muted-foreground">
        <Trans>Models</Trans>
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setQuery("");
          setOpen(next);
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={t`Models`}
              className="mt-2 flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-start text-body text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="min-w-0 truncate">{summary}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          }
        />
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[min(360px,var(--available-width))] gap-0 overflow-hidden p-0 motion-reduce:animate-none"
        >
          <Command label={t`Models`} shouldFilter={false} loop>
            {showSearch ? (
              <ListSearchInput
                command
                query={query}
                setQuery={setQuery}
                label={t`Search models`}
                placeholder={t`Search`}
              />
            ) : null}
            <CommandList className="rk-scroll max-h-80">
              <CommandEmpty>
                <Trans>No matching models</Trans>
              </CommandEmpty>
              {all || query.trim() ? null : (
                <>
                  <CommandGroup>
                    <CommandItem value="show-all" onSelect={() => save([])}>
                      <Trans>Show all</Trans>
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
              <CommandGroup>
                {visible.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.id}
                    data-checked={checked(entry.id)}
                    onSelect={() => toggle(entry.id)}
                  >
                    <span className="min-w-0 truncate">{entry.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? <p className="mt-2 text-body text-destructive">{error}</p> : null}
    </div>
  );
}
