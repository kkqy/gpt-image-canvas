import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  ImageIcon,
  Loader2,
  Maximize2,
  Palette,
  RotateCcw,
  Ruler,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SIZE_PRESETS,
  STYLE_PRESETS,
  type GalleryImageItem,
  type GalleryResponse
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "./i18n";

interface GalleryPageProps {
  onDeleted: (outputId: string) => void;
  onReuse: (item: GalleryImageItem) => void;
}

interface GalleryActionHandlers {
  onCopy: (item: GalleryImageItem) => void;
  onDelete: (item: GalleryImageItem) => void;
  onDownload: (item: GalleryImageItem) => void;
  onReuse: (item: GalleryImageItem) => void;
}

export function GalleryPage({ onDeleted, onReuse }: GalleryPageProps) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<GalleryImageItem[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({});
  const [selectedItem, setSelectedItem] = useState<GalleryImageItem | null>(null);
  const [selectedOutputIds, setSelectedOutputIds] = useState<Set<string>>(() => new Set());
  const [pendingDeleteItem, setPendingDeleteItem] = useState<GalleryImageItem | null>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);
  const [deletingOutputIds, setDeletingOutputIds] = useState<Set<string>>(() => new Set());
  const statusTimerRef = useRef<number | undefined>();

  useEffect(() => {
    const controller = new AbortController();

    async function loadGallery(): Promise<void> {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/gallery", {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await readGalleryError(response, locale, t));
        }

        const body = (await response.json()) as GalleryResponse;
        if (!Array.isArray(body.items)) {
          throw new Error(t("galleryServiceInvalidData"));
        }

        if (!controller.signal.aborted) {
          setItems(body.items);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t("galleryLoadFailed"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadGallery();

    return () => {
      controller.abort();
    };
  }, [locale, t]);

  useEffect(() => {
    if (!selectedItem && !pendingDeleteItem && !pendingBatchDelete) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      if (pendingDeleteItem) {
        setPendingDeleteItem(null);
        return;
      }

      if (pendingBatchDelete) {
        setPendingBatchDelete(false);
        return;
      }

      setSelectedItem(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingBatchDelete, pendingDeleteItem, selectedItem]);

  useEffect(() => {
    return () => {
      window.clearTimeout(statusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectedOutputIds((current) => {
      if (current.size === 0) {
        return current;
      }

      const existingOutputIds = new Set(items.map((item) => item.outputId));
      const next = new Set<string>();
      for (const outputId of current) {
        if (existingOutputIds.has(outputId)) {
          next.add(outputId);
        }
      }

      return next.size === current.size ? current : next;
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) => normalizeSearchText(item.prompt).includes(normalizedQuery));
  }, [items, query]);
  const featuredItem = filteredItems[0] ?? null;
  const gridItems = featuredItem ? filteredItems.slice(1) : filteredItems;
  const selectedItems = useMemo(
    () => items.filter((item) => selectedOutputIds.has(item.outputId)),
    [items, selectedOutputIds]
  );
  const allFilteredItemsSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedOutputIds.has(item.outputId));
  const isDeleting = deletingOutputIds.size > 0;
  const actionHandlers: GalleryActionHandlers = {
    onCopy: (item) => void copyPrompt(item),
    onDelete: requestDelete,
    onDownload: downloadItem,
    onReuse
  };

  function showStatus(message: string): void {
    window.clearTimeout(statusTimerRef.current);
    setError("");
    setStatusMessage(message);
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage("");
    }, 3200);
  }

  function togglePrompt(outputId: string): void {
    setExpandedPrompts((current) => ({
      ...current,
      [outputId]: !current[outputId]
    }));
  }

  async function copyPrompt(item: GalleryImageItem): Promise<void> {
    try {
      await writeClipboardText(item.prompt);
      showStatus(t("galleryCopiedPrompt"));
    } catch {
      setError(t("generationCopyFailed"));
    }
  }

  function downloadItem(item: GalleryImageItem): void {
    window.open(`/api/assets/${encodeURIComponent(item.asset.id)}/download`, "_blank", "noopener,noreferrer");
    showStatus(t("galleryOpenDownload"));
  }

  function downloadSelectedItems(): void {
    for (const item of selectedItems) {
      triggerAssetDownload(item);
    }
    showStatus(t("galleryBatchDownloadStarted", { count: selectedItems.length }));
  }

  function toggleSelectedItem(item: GalleryImageItem): void {
    setSelectedOutputIds((current) => {
      const next = new Set(current);
      if (next.has(item.outputId)) {
        next.delete(item.outputId);
      } else {
        next.add(item.outputId);
      }
      return next;
    });
  }

  function selectFilteredItems(): void {
    setSelectedOutputIds((current) => {
      const next = new Set(current);
      for (const item of filteredItems) {
        next.add(item.outputId);
      }
      return next;
    });
  }

  function clearSelection(): void {
    setSelectedOutputIds(new Set());
  }

  function requestDelete(item: GalleryImageItem): void {
    setError("");
    setPendingDeleteItem(item);
  }

  async function deleteItem(item: GalleryImageItem): Promise<void> {
    setDeletingOutputIds(new Set([item.outputId]));
    setError("");

    try {
      const response = await fetch(`/api/gallery/${encodeURIComponent(item.outputId)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(await readGalleryError(response, locale, t));
      }

      setItems((current) => current.filter((galleryItem) => galleryItem.outputId !== item.outputId));
      setSelectedOutputIds((current) => {
        if (!current.has(item.outputId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(item.outputId);
        return next;
      });
      setSelectedItem((current) => (current?.outputId === item.outputId ? null : current));
      setPendingDeleteItem(null);
      onDeleted(item.outputId);
      showStatus(t("galleryDeleted"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("galleryDeleteFailed"));
    } finally {
      setDeletingOutputIds(new Set());
    }
  }

  async function deleteSelectedItems(): Promise<void> {
    const outputIds = selectedItems.map((item) => item.outputId);
    if (outputIds.length === 0) {
      return;
    }

    setDeletingOutputIds(new Set(outputIds));
    setError("");

    const deletedOutputIds: string[] = [];
    let firstError: Error | undefined;
    try {
      const results = await Promise.all(
        outputIds.map(async (outputId) => {
          try {
            const response = await fetch(`/api/gallery/${encodeURIComponent(outputId)}`, {
              method: "DELETE"
            });
            if (!response.ok) {
              throw new Error(await readGalleryError(response, locale, t));
            }
            return { outputId };
          } catch (deleteError) {
            return {
              error: deleteError instanceof Error ? deleteError : new Error(t("galleryBatchDeleteFailed")),
              outputId
            };
          }
        })
      );

      for (const result of results) {
        if (result.error) {
          firstError ??= result.error;
        } else {
          deletedOutputIds.push(result.outputId);
        }
      }
    } catch {
      firstError = new Error(t("galleryBatchDeleteFailed"));
    } finally {
      if (deletedOutputIds.length > 0) {
        const deletedSet = new Set(deletedOutputIds);
        setItems((current) => current.filter((galleryItem) => !deletedSet.has(galleryItem.outputId)));
        setSelectedOutputIds((current) => {
          const next = new Set(current);
          for (const outputId of deletedSet) {
            next.delete(outputId);
          }
          return next;
        });
        setSelectedItem((current) => (current && deletedSet.has(current.outputId) ? null : current));
        for (const outputId of deletedOutputIds) {
          onDeleted(outputId);
        }
        if (!firstError) {
          showStatus(t("galleryBatchDeleted", { count: deletedOutputIds.length }));
        }
      }

      if (firstError) {
        setError(firstError.message);
      }

      setPendingBatchDelete(false);
      setDeletingOutputIds(new Set());
    }
  }

  return (
    <main className="gallery-page app-view" data-testid="gallery-page">
      <div className="gallery-page__inner">
        <header className="gallery-header">
          <div className="gallery-header__copy">
            <p className="gallery-kicker">
              <Sparkles className="size-3.5" aria-hidden="true" />
              {t("galleryKicker")}
            </p>
            <h1>{t("galleryTitle")}</h1>
          </div>
          <div className="gallery-header__meta" aria-label={t("galleryHeaderMeta", { count: items.length })}>
            <strong>{items.length}</strong>
            <span>{t("galleryWorkCount")}</span>
            <span>{t("galleryWorkSort")}</span>
          </div>
          <div className="gallery-search" role="search">
            <Search className="size-4" aria-hidden="true" />
            <input
              aria-label={t("gallerySearchAria")}
              className="gallery-search__input"
              data-testid="gallery-search"
              id="gallery-search-input"
              name="gallery-search"
              placeholder={t("gallerySearchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </header>

        <GalleryBulkToolbar
          allFilteredItemsSelected={allFilteredItemsSelected}
          disabled={isDeleting}
          filteredCount={filteredItems.length}
          selectedCount={selectedOutputIds.size}
          onClearSelection={clearSelection}
          onDeleteSelected={() => setPendingBatchDelete(true)}
          onDownloadSelected={downloadSelectedItems}
          onSelectFiltered={selectFilteredItems}
        />

        {error ? (
          <div className="gallery-alert gallery-alert--error" data-testid="gallery-error" role="alert">
            <XCircle className="size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : null}
        {statusMessage ? (
          <div className="gallery-alert gallery-alert--success" data-testid="gallery-message" role="status">
            <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
            <p>{statusMessage}</p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="gallery-empty-state" data-testid="gallery-loading" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <p>{t("galleryLoading")}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="gallery-empty-state" data-testid="gallery-empty">
            <ImageIcon className="size-7" aria-hidden="true" />
            <div>
              <p>{items.length === 0 ? t("galleryEmpty") : t("galleryNoMatches")}</p>
              <span>{items.length === 0 ? t("galleryEmptyHint") : t("galleryNoMatchesHint")}</span>
            </div>
          </div>
        ) : (
          <>
            {featuredItem ? (
              <FeaturedGalleryItem
                deleting={deletingOutputIds.has(featuredItem.outputId)}
                expanded={Boolean(expandedPrompts[featuredItem.outputId])}
                isSelected={selectedOutputIds.has(featuredItem.outputId)}
                item={featuredItem}
                onOpen={setSelectedItem}
                onToggleSelected={toggleSelectedItem}
                onTogglePrompt={togglePrompt}
                {...actionHandlers}
              />
            ) : null}

            {gridItems.length > 0 ? (
              <div className="gallery-grid" data-testid="gallery-grid">
                {gridItems.map((item) => (
                  <GalleryCard
                    deleting={deletingOutputIds.has(item.outputId)}
                    expanded={Boolean(expandedPrompts[item.outputId])}
                    isSelected={selectedOutputIds.has(item.outputId)}
                    item={item}
                    key={item.outputId}
                    onOpen={setSelectedItem}
                    onToggleSelected={toggleSelectedItem}
                    onTogglePrompt={togglePrompt}
                    {...actionHandlers}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {selectedItem ? (
        <GalleryDetailDialog
          deleting={deletingOutputIds.has(selectedItem.outputId)}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onCopy={() => void copyPrompt(selectedItem)}
          onDelete={() => requestDelete(selectedItem)}
          onDownload={() => downloadItem(selectedItem)}
          onReuse={() => onReuse(selectedItem)}
        />
      ) : null}

      {pendingDeleteItem ? (
        <DeleteGalleryDialog
          deleting={deletingOutputIds.has(pendingDeleteItem.outputId)}
          item={pendingDeleteItem}
          onCancel={() => setPendingDeleteItem(null)}
          onConfirm={() => void deleteItem(pendingDeleteItem)}
        />
      ) : null}

      {pendingBatchDelete ? (
        <DeleteGalleryBatchDialog
          count={selectedOutputIds.size}
          deleting={isDeleting}
          onCancel={() => setPendingBatchDelete(false)}
          onConfirm={() => void deleteSelectedItems()}
        />
      ) : null}
    </main>
  );
}

function GalleryBulkToolbar({
  allFilteredItemsSelected,
  disabled,
  filteredCount,
  selectedCount,
  onClearSelection,
  onDeleteSelected,
  onDownloadSelected,
  onSelectFiltered
}: {
  allFilteredItemsSelected: boolean;
  disabled: boolean;
  filteredCount: number;
  selectedCount: number;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onDownloadSelected: () => void;
  onSelectFiltered: () => void;
}) {
  const { t } = useI18n();
  const hasSelection = selectedCount > 0;

  return (
    <section className="gallery-bulk-toolbar" data-testid="gallery-bulk-toolbar" aria-label={t("galleryBatchActionsLabel")}>
      <p className="gallery-bulk-toolbar__count">{t("gallerySelectedCount", { count: selectedCount })}</p>
      <div className="gallery-bulk-toolbar__actions">
        <button className="secondary-action h-10" disabled={disabled || filteredCount === 0 || allFilteredItemsSelected} type="button" onClick={onSelectFiltered}>
          {t("gallerySelectCurrent")}
        </button>
        <button className="secondary-action h-10" disabled={disabled || !hasSelection} type="button" onClick={onClearSelection}>
          {t("galleryClearSelection")}
        </button>
        <button className="secondary-action h-10" disabled={disabled || !hasSelection} type="button" onClick={onDownloadSelected}>
          <Download className="size-4" aria-hidden="true" />
          {t("galleryBatchDownload")}
        </button>
        <button className="danger-action h-10" disabled={disabled || !hasSelection} type="button" onClick={onDeleteSelected}>
          {disabled ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
          {t("galleryBatchDelete")}
        </button>
      </div>
    </section>
  );
}

function FeaturedGalleryItem({
  deleting,
  expanded,
  isSelected,
  item,
  onCopy,
  onDelete,
  onDownload,
  onOpen,
  onReuse,
  onToggleSelected,
  onTogglePrompt
}: {
  deleting: boolean;
  expanded: boolean;
  isSelected: boolean;
  item: GalleryImageItem;
  onOpen: (item: GalleryImageItem) => void;
  onToggleSelected: (item: GalleryImageItem) => void;
  onTogglePrompt: (outputId: string) => void;
} & GalleryActionHandlers) {
  const { formatDateTime, t } = useI18n();

  return (
    <article className="gallery-feature" data-selected={isSelected} data-testid="gallery-feature">
      <button
        aria-label={t("galleryActionOpenLatest", { excerpt: promptExcerpt(item.prompt) })}
        className="gallery-feature__image-button"
        type="button"
        onClick={() => onOpen(item)}
      >
        <img
          alt={item.prompt}
          className="gallery-feature__image"
          height={item.asset.height}
          src={assetPreviewUrl(item.asset.id, 1024)}
          width={item.asset.width}
        />
        <span className="gallery-feature__badge">{t("galleryBadgeLatest")}</span>
        <span className="gallery-card__zoom">
          <Maximize2 className="size-4" aria-hidden="true" />
        </span>
      </button>
      <GallerySelectButton isSelected={isSelected} item={item} onToggleSelected={onToggleSelected} />

      <div className="gallery-feature__body">
        <GalleryTags item={item} />
        <div className="gallery-feature__prompt-panel">
          <CollapsiblePrompt
            expanded={expanded}
            label={t("galleryPromptLabel")}
            lines={4}
            text={item.prompt}
            onToggle={() => onTogglePrompt(item.outputId)}
          />
        </div>
        <div className="gallery-feature__footer">
          <div className="gallery-feature__meta">
            <span>
              <Clock3 className="size-3.5" aria-hidden="true" />
              {formatCreatedTime(item.createdAt, formatDateTime)}
            </span>
            <span>{item.outputFormat.toUpperCase()}</span>
            <span>{t("qualityLabel", { quality: item.quality })}</span>
          </div>
          <GalleryIconActions
            deleting={deleting}
            item={item}
            onCopy={onCopy}
            onDelete={onDelete}
            onDownload={onDownload}
            onReuse={onReuse}
          />
        </div>
      </div>
    </article>
  );
}

function GalleryCard({
  deleting,
  expanded,
  isSelected,
  item,
  onCopy,
  onDelete,
  onDownload,
  onOpen,
  onReuse,
  onToggleSelected,
  onTogglePrompt
}: {
  deleting: boolean;
  expanded: boolean;
  isSelected: boolean;
  item: GalleryImageItem;
  onOpen: (item: GalleryImageItem) => void;
  onToggleSelected: (item: GalleryImageItem) => void;
  onTogglePrompt: (outputId: string) => void;
} & GalleryActionHandlers) {
  const { formatDateTime, t } = useI18n();

  return (
    <article className="gallery-card" data-selected={isSelected} data-testid="gallery-card">
      <button
        aria-label={t("galleryActionOpenImage", { excerpt: promptExcerpt(item.prompt) })}
        className="gallery-card__image-button"
        type="button"
        onClick={() => onOpen(item)}
      >
        <img
          alt={item.prompt}
          className="gallery-card__image"
          height={item.asset.height}
          loading="lazy"
          src={assetPreviewUrl(item.asset.id, 512)}
          width={item.asset.width}
        />
        <span className="gallery-card__zoom">
          <Maximize2 className="size-4" aria-hidden="true" />
        </span>
      </button>
      <GallerySelectButton isSelected={isSelected} item={item} onToggleSelected={onToggleSelected} />

      <div className="gallery-card__body">
        <GalleryTags item={item} compact />
        <CollapsiblePrompt
          expanded={expanded}
          label={t("galleryPromptLabel")}
          lines={2}
          text={item.prompt}
          onToggle={() => onTogglePrompt(item.outputId)}
        />
        <div className="gallery-card__footer">
          <span className="gallery-time-tag">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {formatCreatedTime(item.createdAt, formatDateTime)}
          </span>
          <GalleryIconActions
            deleting={deleting}
            item={item}
            onCopy={onCopy}
            onDelete={onDelete}
            onDownload={onDownload}
            onReuse={onReuse}
          />
        </div>
      </div>
    </article>
  );
}

function GallerySelectButton({
  isSelected,
  item,
  onToggleSelected
}: {
  isSelected: boolean;
  item: GalleryImageItem;
  onToggleSelected: (item: GalleryImageItem) => void;
}) {
  const { t } = useI18n();

  return (
    <button
      aria-pressed={isSelected}
      aria-label={t("gallerySelectImage", { excerpt: promptExcerpt(item.prompt) })}
      className="gallery-select-button"
      data-selected={isSelected}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggleSelected(item);
      }}
    >
      {isSelected ? <Check className="size-4" aria-hidden="true" /> : null}
    </button>
  );
}

function GalleryIconActions({
  deleting,
  item,
  onCopy,
  onDelete,
  onDownload,
  onReuse
}: {
  deleting: boolean;
  item: GalleryImageItem;
} & GalleryActionHandlers) {
  const { t } = useI18n();
  const excerpt = promptExcerpt(item.prompt);

  return (
    <div className="gallery-card__actions">
      <button
        aria-label={t("galleryActionCopyPrompt", { excerpt })}
        className="gallery-icon-action"
        title={t("galleryPromptLabel")}
        type="button"
        onClick={() => onCopy(item)}
      >
        <Copy className="size-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("galleryActionDownloadImage", { excerpt })}
        className="gallery-icon-action"
        title={t("galleryDownloadOriginal")}
        type="button"
        onClick={() => onDownload(item)}
      >
        <Download className="size-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("galleryActionReusePrompt", { excerpt })}
        className="gallery-icon-action"
        title={t("galleryReuseToCanvas")}
        type="button"
        onClick={() => onReuse(item)}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("galleryActionDeleteImage", { excerpt })}
        className="gallery-icon-action gallery-icon-action--danger"
        disabled={deleting}
        title={t("galleryRemovedTitle")}
        type="button"
        onClick={() => onDelete(item)}
      >
        {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

function GalleryTags({ item, compact = false }: { item: GalleryImageItem; compact?: boolean }) {
  const { t } = useI18n();
  const styleLabel = styleTagLabel(item.presetId, t);
  const sizeLabel = sizeTagLabel(item, t);

  return (
    <div className="gallery-tags" data-compact={compact}>
      <span className="gallery-tag gallery-tag--mode">{t("galleryModeLabel", { mode: item.mode })}</span>
      {styleLabel ? (
        <span className="gallery-tag gallery-tag--style">
          <Palette className="size-3.5" aria-hidden="true" />
          {styleLabel}
        </span>
      ) : null}
      <span className="gallery-tag gallery-tag--size">
        <Ruler className="size-3.5" aria-hidden="true" />
        {sizeLabel}
      </span>
    </div>
  );
}

function CollapsiblePrompt({
  expanded,
  label,
  lines,
  text,
  onToggle
}: {
  expanded: boolean;
  label: string;
  lines: 2 | 4 | 8;
  text: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  return (
    <section className="gallery-prompt-block">
      <div className="gallery-prompt-heading">
        <h3 className="gallery-prompt-label">{label}</h3>
        <button
          aria-expanded={expanded}
          className="gallery-prompt-toggle"
          data-expanded={expanded}
          type="button"
          onClick={onToggle}
        >
          {expanded ? t("galleryToggleCollapse") : t("galleryToggleExpand")}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <p className="gallery-prompt-text" data-expanded={expanded} data-lines={lines}>
        {text}
      </p>
    </section>
  );
}

function GalleryDetailDialog({
  deleting,
  item,
  onClose,
  onCopy,
  onDelete,
  onDownload,
  onReuse
}: {
  deleting: boolean;
  item: GalleryImageItem;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onReuse: () => void;
}) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const { formatDateTime, t } = useI18n();

  return (
    <div className="gallery-modal-backdrop" data-testid="gallery-detail" role="presentation">
      <div aria-labelledby="gallery-detail-title" aria-modal="true" className="gallery-modal" role="dialog">
        <header className="gallery-modal__header">
          <div className="gallery-modal__title">
            <p>{t("galleryDetailEyebrow")}</p>
            <h2 id="gallery-detail-title">{t("galleryDetailTitle")}</h2>
            <GalleryTags item={item} />
          </div>
          <button aria-label={t("commonClose")} className="gallery-icon-action gallery-modal__close" type="button" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="gallery-modal__body">
          <div className="gallery-modal__media">
            <img
              alt={item.prompt}
              className="gallery-modal__image"
              height={item.asset.height}
              src={item.asset.url}
              width={item.asset.width}
            />
          </div>

          <aside className="gallery-modal__copy">
            <div className="gallery-modal__meta">
              <span>
              <Clock3 className="size-3.5" aria-hidden="true" />
                {formatCreatedTime(item.createdAt, formatDateTime)}
              </span>
              <span>{item.outputFormat.toUpperCase()}</span>
              <span>{t("qualityLabel", { quality: item.quality })}</span>
            </div>
            <CollapsiblePrompt
              expanded={promptExpanded}
              label={t("galleryPromptLabel")}
              lines={8}
              text={item.prompt}
              onToggle={() => setPromptExpanded((current) => !current)}
            />
          </aside>
        </div>

        <footer className="gallery-modal__actions">
          <button className="secondary-action h-10" type="button" onClick={onCopy}>
            <Copy className="size-4" aria-hidden="true" />
            {t("commonCopy")}
          </button>
          <button className="secondary-action h-10" type="button" onClick={onDownload}>
            <Download className="size-4" aria-hidden="true" />
            {t("commonDownload")}
          </button>
          <button className="secondary-action h-10" type="button" onClick={onReuse}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("commonReuse")}
          </button>
          <button className="secondary-action h-10 text-red-700 hover:text-red-800" disabled={deleting} type="button" onClick={onDelete}>
            {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {t("commonRemove")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeleteGalleryDialog({
  deleting,
  item,
  onCancel,
  onConfirm
}: {
  deleting: boolean;
  item: GalleryImageItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="gallery-confirm-backdrop" data-testid="gallery-delete-dialog" role="presentation">
      <div
        aria-describedby="gallery-delete-description"
        aria-labelledby="gallery-delete-title"
        aria-modal="true"
        className="gallery-confirm"
        role="dialog"
      >
        <div className="gallery-confirm__icon">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <div className="gallery-confirm__copy">
          <h2 id="gallery-delete-title">{t("galleryConfirmDeleteTitle")}</h2>
          <p id="gallery-delete-description">
            {t("galleryConfirmDeleteBody", { excerpt: promptExcerpt(item.prompt) })}
          </p>
        </div>
        <div className="gallery-confirm__actions">
          <button className="secondary-action h-10" disabled={deleting} type="button" onClick={onCancel}>
            {t("commonCancel")}
          </button>
          <button className="danger-action h-10" disabled={deleting} type="button" onClick={onConfirm}>
            {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {t("galleryConfirmRemove")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteGalleryBatchDialog({
  count,
  deleting,
  onCancel,
  onConfirm
}: {
  count: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="gallery-confirm-backdrop" data-testid="gallery-batch-delete-dialog" role="presentation">
      <div
        aria-describedby="gallery-batch-delete-description"
        aria-labelledby="gallery-batch-delete-title"
        aria-modal="true"
        className="gallery-confirm"
        role="dialog"
      >
        <div className="gallery-confirm__icon">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <div className="gallery-confirm__copy">
          <h2 id="gallery-batch-delete-title">{t("galleryBatchDeleteTitle", { count })}</h2>
          <p id="gallery-batch-delete-description">{t("galleryBatchDeleteBody", { count })}</p>
        </div>
        <div className="gallery-confirm__actions">
          <button className="secondary-action h-10" disabled={deleting} type="button" onClick={onCancel}>
            {t("commonCancel")}
          </button>
          <button className="danger-action h-10" disabled={deleting} type="button" onClick={onConfirm}>
            {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {t("galleryConfirmRemove")}
          </button>
        </div>
      </div>
    </div>
  );
}

function triggerAssetDownload(item: GalleryImageItem): void {
  const link = document.createElement("a");
  link.href = `/api/assets/${encodeURIComponent(item.asset.id)}/download`;
  link.rel = "noopener noreferrer";
  link.target = "_blank";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function assetPreviewUrl(assetId: string, width: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/preview?width=${width}`;
}

function styleTagLabel(presetId: string, t: Translate): string {
  if (presetId === "none") {
    return "";
  }

  const preset = STYLE_PRESETS.find((item) => item.id === presetId);
  return preset ? t("stylePresetLabel", { presetId: preset.id, fallback: preset.label }) : "";
}

function sizeTagLabel(item: GalleryImageItem, t: Translate): string {
  const preset = SIZE_PRESETS.find((sizePreset) => sizePreset.width === item.size.width && sizePreset.height === item.size.height);
  const presetLabel = preset ? t("sizePresetLabel", { presetId: preset.id, fallback: preset.label }) : t("customSize");
  return `${presetLabel} · ${item.size.width} x ${item.size.height}`;
}

function promptExcerpt(promptValue: string): string {
  const compact = promptValue.replace(/\s+/gu, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

function formatCreatedTime(value: string, formatDateTime: (value: string) => string): string {
  return formatDateTime(value);
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

async function readGalleryError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("galleryRequestFailed", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("galleryRequestFailed", { status: response.status });
  }
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command was not accepted.");
    }
  } finally {
    textArea.remove();
  }
}
