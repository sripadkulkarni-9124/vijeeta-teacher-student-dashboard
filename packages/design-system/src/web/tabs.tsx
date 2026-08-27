import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface TabItem {
  id: string;
  label: string;
  panel: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  label: string;
  items: readonly TabItem[];
  defaultTabId?: string;
}

export function Tabs({ defaultTabId, items, label }: TabsProps) {
  const enabledItems = items.filter((item) => !item.disabled);
  const firstAvailable = enabledItems[0]?.id ?? "";
  const requestedDefault = items.find(
    (item) => item.id === defaultTabId && !item.disabled,
  )?.id;
  const [selectedId, setSelectedId] = useState(
    requestedDefault ?? firstAvailable,
  );
  const activeId = enabledItems.some((item) => item.id === selectedId)
    ? selectedId
    : firstAvailable;
  const baseId = `vjt-tabs-${useId()}`;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const selected = enabledItems.find((item) => item.id === activeId);

  useEffect(() => {
    if (selectedId !== activeId) setSelectedId(activeId);
  }, [activeId, selectedId]);

  function activate(id: string) {
    setSelectedId(id);
    refs.current.get(id)?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentId: string,
  ) {
    if (enabledItems.length === 0) return;

    const currentIndex = enabledItems.findIndex(
      (item) => item.id === currentId,
    );
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % enabledItems.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + enabledItems.length) % enabledItems.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabledItems.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    activate(enabledItems[nextIndex].id);
  }

  return (
    <div className="vjt-tabs">
      <div aria-label={label} className="vjt-tabs__list" role="tablist">
        {items.map((item) => {
          const isSelected = item.id === activeId;
          const tabId = `${baseId}-tab-${item.id}`;
          const panelId = `${baseId}-panel-${item.id}`;

          return (
            <button
              aria-controls={panelId}
              aria-selected={isSelected}
              className="vjt-tab"
              disabled={item.disabled}
              id={tabId}
              key={item.id}
              onClick={() => activate(item.id)}
              onKeyDown={(event) => handleKeyDown(event, item.id)}
              ref={(element) => {
                if (element) refs.current.set(item.id, element);
                else refs.current.delete(item.id);
              }}
              role="tab"
              tabIndex={isSelected ? 0 : -1}
              type="button"
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {selected ? (
        <div
          aria-labelledby={`${baseId}-tab-${selected.id}`}
          id={`${baseId}-panel-${selected.id}`}
          role="tabpanel"
          tabIndex={0}
        >
          {selected.panel}
        </div>
      ) : null}
    </div>
  );
}
