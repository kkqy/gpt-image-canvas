import {
  AlertTriangle,
  Check,
  CheckCircle2,
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
  type GeneratedAsset,
  type GalleryImageItem,
  type GalleryResponse
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import { assetPreviewUrl } from "../../shared/api/assets";

interface GalleryPageProps {
  onDeleted: (items: DeletedGalleryItem[]) => void;
  onReuse: (item: GalleryImageItem) => void;
}

interface DeletedGalleryItem {
  outputId: string;
  assetId: string;
}

interface GalleryActionHandlers {
  onCopy: (item: GalleryImageItem) => void;
  onDelete: (item: GalleryImageItem) => void;
  onDownload: (item: GalleryImageItem) => void;
  onReuse: (item: GalleryImageItem) => void;
}

interface BatchDownloadState {
  isActive: boolean;
  total: number;
  completed: number;
  failed: number;
  currentFileName: string;
  currentLoaded: number;
  currentTotal: number | null;
}

interface BatchDeleteState {
  isActive: boolean;
  total: number;
  completed: number;
  failed: number;
  currentFileName: string;
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
  const [batchDownload, setBatchDownload] = useState<BatchDownloadState | null>(null);
  const [batchDelete, setBatchDelete] = useState<BatchDeleteState | null>(null);
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const statusTimerRef = useRef<number | undefined>();
  const copiedTimerRef = useRef<number | undefined>();
  const batchDownloadAbortRef = useRef<AbortController | null>(null);
  const batchDeleteAbortRef = useRef<AbortController | null>(null);
  const selectionAnchorOutputIdRef = useRef<string | null>(null);

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
      window.clearTimeout(copiedTimerRef.current);
      batchDownloadAbortRef.current?.abort();
      batchDeleteAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const existingOutputIds = new Set(items.map((item) => item.outputId));

    setSelectedOutputIds((current) => {
      if (current.size === 0) {
        return current;
      }

      const next = new Set<string>();
      for (const outputId of current) {
        if (existingOutputIds.has(outputId)) {
          next.add(outputId);
        }
      }

      return next.size === current.size ? current : next;
    });

    if (selectionAnchorOutputIdRef.current && !existingOutputIds.has(selectionAnchorOutputIdRef.current)) {
      selectionAnchorOutputIdRef.current = null;
    }
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
  const isBatchDownloading = batchDownload?.isActive ?? false;
  const isBatchDeleting = batchDelete?.isActive ?? false;
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
      window.clearTimeout(copiedTimerRef.current);
      setCopiedOutputId(item.outputId);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedOutputId((current) => (current === item.outputId ? null : current));
        copiedTimerRef.current = undefined;
      }, 1800);
      showStatus(t("galleryCopiedPrompt"));
    } catch {
      setError(t("generationCopyFailed"));
    }
  }

  function downloadItem(item: GalleryImageItem): void {
    triggerAssetDownload(item.asset);
    showStatus(t("galleryOpenDownload"));
  }

  async function downloadSelectedItems(): Promise<void> {
    if (selectedItems.length === 0 || isBatchDownloading) {
      return;
    }

    const queue = [...selectedItems];
    const controller = new AbortController();
    batchDownloadAbortRef.current = controller;
    let completed = 0;
    let failed = 0;

    window.clearTimeout(statusTimerRef.current);
    setError("");
    setStatusMessage("");
    setBatchDownload({
      completed,
      currentFileName: "",
      currentLoaded: 0,
      currentTotal: null,
      failed,
      isActive: true,
      total: queue.length
    });

    for (const item of queue) {
      if (controller.signal.aborted) {
        break;
      }

      setBatchDownload((current) =>
        current
          ? {
              ...current,
              currentFileName: item.asset.fileName,
              currentLoaded: 0,
              currentTotal: null
            }
          : current
      );

      try {
        await downloadAssetWithProgress(item.asset, controller.signal, (loaded, total) => {
          setBatchDownload((current) =>
            current
              ? {
                  ...current,
                  currentLoaded: loaded,
                  currentTotal: total
                }
              : current
          );
        });
        completed += 1;
      } catch {
        if (controller.signal.aborted) {
          break;
        }
        failed += 1;
      }

      setBatchDownload((current) =>
        current
          ? {
              ...current,
              completed,
              failed
            }
          : current
      );

      if (!controller.signal.aborted) {
        await waitForNextQueueItem(controller.signal, 250);
      }
    }

    const wasCancelled = controller.signal.aborted;
    if (batchDownloadAbortRef.current === controller) {
      batchDownloadAbortRef.current = null;
    }
    setBatchDownload(null);

    if (wasCancelled) {
      showStatus(t("galleryBatchDownloadCancelled", { completed, total: queue.length }));
      return;
    }

    if (failed > 0) {
      setError(t("galleryBatchDownloadFinishedWithErrors", { completed, failed, total: queue.length }));
      return;
    }

    showStatus(t("galleryBatchDownloadFinished", { count: completed }));
  }

  function cancelBatchDownload(): void {
    batchDownloadAbortRef.current?.abort();
  }

  function toggleSelectedItem(item: GalleryImageItem, shiftKey = false): void {
    const currentIndex = filteredItems.findIndex((filteredItem) => filteredItem.outputId === item.outputId);
    const anchorOutputId = selectionAnchorOutputIdRef.current;
    const anchorIndex = anchorOutputId ? filteredItems.findIndex((filteredItem) => filteredItem.outputId === anchorOutputId) : -1;
    const shouldSelectRange = shiftKey && currentIndex !== -1 && anchorIndex !== -1;

    setSelectedOutputIds((current) => {
      const next = new Set(current);

      if (shouldSelectRange) {
        const startIndex = Math.min(anchorIndex, currentIndex);
        const endIndex = Math.max(anchorIndex, currentIndex);
        for (const rangeItem of filteredItems.slice(startIndex, endIndex + 1)) {
          next.add(rangeItem.outputId);
        }
      } else if (next.has(item.outputId)) {
        next.delete(item.outputId);
      } else {
        next.add(item.outputId);
      }
      return next;
    });
    selectionAnchorOutputIdRef.current = item.outputId;
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
    selectionAnchorOutputIdRef.current = null;
  }

  function requestDelete(item: GalleryImageItem): void {
    if (isDeleting) {
      return;
    }

    setError("");
    setPendingDeleteItem(item);
  }

  async function deleteItem(item: GalleryImageItem): Promise<void> {
    if (isDeleting) {
      return;
    }

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
      if (selectionAnchorOutputIdRef.current === item.outputId) {
        selectionAnchorOutputIdRef.current = null;
      }
      setCopiedOutputId((current) => (current === item.outputId ? null : current));
      setPendingDeleteItem(null);
      onDeleted([{ assetId: item.asset.id, outputId: item.outputId }]);
      showStatus(t("galleryDeleted"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("galleryDeleteFailed"));
    } finally {
      setDeletingOutputIds(new Set());
    }
  }

  async function deleteSelectedItems(): Promise<void> {
    if (selectedItems.length === 0 || isBatchDeleting) {
      return;
    }

    const queue = [...selectedItems];
    const controller = new AbortController();
    batchDeleteAbortRef.current = controller;
    let completed = 0;
    let failed = 0;

    setPendingBatchDelete(false);
    window.clearTimeout(statusTimerRef.current);
    setDeletingOutputIds(new Set(queue.map((item) => item.outputId)));
    setError("");
    setStatusMessage("");
    setBatchDelete({
      completed,
      currentFileName: "",
      failed,
      isActive: true,
      total: queue.length
    });

    for (const item of queue) {
      if (controller.signal.aborted) {
        break;
      }

      setBatchDelete((current) =>
        current
          ? {
              ...current,
              currentFileName: item.asset.fileName
            }
          : current
      );

      try {
        const response = await fetch(`/api/gallery/${encodeURIComponent(item.outputId)}`, {
          method: "DELETE",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await readGalleryError(response, locale, t));
        }

        completed += 1;
        applyDeletedGalleryItems([{ assetId: item.asset.id, outputId: item.outputId }]);
      } catch {
        if (controller.signal.aborted) {
          break;
        }
        failed += 1;
      }

      setDeletingOutputIds((current) => {
        const next = new Set(current);
        next.delete(item.outputId);
        return next;
      });
      setBatchDelete((current) =>
        current
          ? {
              ...current,
              completed,
              failed
            }
          : current
      );

      if (!controller.signal.aborted) {
        await waitForNextQueueItem(controller.signal, 120);
      }
    }

    const wasCancelled = controller.signal.aborted;
    if (batchDeleteAbortRef.current === controller) {
      batchDeleteAbortRef.current = null;
    }
    setDeletingOutputIds(new Set());
    setBatchDelete(null);

    if (wasCancelled) {
      showStatus(t("galleryBatchDeleteCancelled", { completed, total: queue.length }));
      return;
    }

    if (failed > 0) {
      setError(t("galleryBatchDeleteFinishedWithErrors", { completed, failed, total: queue.length }));
      return;
    }

    showStatus(t("galleryBatchDeleted", { count: completed }));
  }

  function cancelBatchDelete(): void {
    batchDeleteAbortRef.current?.abort();
  }

  function applyDeletedGalleryItems(deletedItems: DeletedGalleryItem[]): void {
    const deletedOutputIds = deletedItems.map((item) => item.outputId);
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
    if (selectionAnchorOutputIdRef.current && deletedSet.has(selectionAnchorOutputIdRef.current)) {
      selectionAnchorOutputIdRef.current = null;
    }
    onDeleted(deletedItems);
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
          disabled={isDeleting || isBatchDownloading || isBatchDeleting}
          filteredCount={filteredItems.length}
          selectedCount={selectedOutputIds.size}
          onClearSelection={clearSelection}
          onDeleteSelected={() => setPendingBatchDelete(true)}
          onDownloadSelected={() => void downloadSelectedItems()}
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
        {batchDownload ? <GalleryBatchDownloadProgress batchDownload={batchDownload} onCancel={cancelBatchDownload} /> : null}
        {batchDelete ? <GalleryBatchDeleteProgress batchDelete={batchDelete} onCancel={cancelBatchDelete} /> : null}

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
                copied={copiedOutputId === featuredItem.outputId}
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
                    copied={copiedOutputId === item.outputId}
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
          copied={copiedOutputId === selectedItem.outputId}
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

function GalleryBatchDownloadProgress({
  batchDownload,
  onCancel
}: {
  batchDownload: BatchDownloadState;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const currentPercent = batchDownload.currentTotal
    ? Math.min(100, Math.round((batchDownload.currentLoaded / batchDownload.currentTotal) * 100))
    : null;
  const currentFraction = batchDownload.currentTotal ? Math.min(1, batchDownload.currentLoaded / batchDownload.currentTotal) : 0;
  const overallPercent = Math.min(100, Math.round(((batchDownload.completed + currentFraction) / batchDownload.total) * 100));

  return (
    <section className="gallery-download-progress" data-testid="gallery-download-progress" role="status" aria-live="polite">
      <div className="gallery-download-progress__header">
        <div>
          <p>{t("galleryBatchDownloadProgressTitle", { completed: batchDownload.completed, total: batchDownload.total })}</p>
          <span>
            {batchDownload.currentFileName
              ? t("galleryBatchDownloadCurrent", { fileName: batchDownload.currentFileName })
              : t("galleryBatchDownloadPreparing")}
          </span>
        </div>
        <button className="secondary-action h-9" type="button" onClick={onCancel}>
          {t("galleryBatchDownloadCancel")}
        </button>
      </div>
      <div className="gallery-download-progress__bar" aria-label={t("galleryBatchDownloadOverall", { percent: overallPercent })}>
        <span style={{ width: `${overallPercent}%` }} />
      </div>
      <div className="gallery-download-progress__meta">
        <span>{t("galleryBatchDownloadOverall", { percent: overallPercent })}</span>
        <span>
          {currentPercent === null
            ? t("galleryBatchDownloadLoaded", { loaded: formatFileSize(batchDownload.currentLoaded) })
            : t("galleryBatchDownloadCurrentBytes", {
                loaded: formatFileSize(batchDownload.currentLoaded),
                percent: currentPercent,
                total: formatFileSize(batchDownload.currentTotal ?? 0)
              })}
        </span>
        {batchDownload.failed > 0 ? <span>{t("galleryBatchDownloadFailedCount", { count: batchDownload.failed })}</span> : null}
      </div>
    </section>
  );
}

function GalleryBatchDeleteProgress({
  batchDelete,
  onCancel
}: {
  batchDelete: BatchDeleteState;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const processedCount = batchDelete.completed + batchDelete.failed;
  const overallPercent = Math.min(100, Math.round((processedCount / batchDelete.total) * 100));

  return (
    <section className="gallery-download-progress gallery-download-progress--delete" data-testid="gallery-delete-progress" role="status" aria-live="polite">
      <div className="gallery-download-progress__header">
        <div>
          <p>{t("galleryBatchDeleteProgressTitle", { completed: batchDelete.completed, total: batchDelete.total })}</p>
          <span>
            {batchDelete.currentFileName
              ? t("galleryBatchDeleteCurrent", { fileName: batchDelete.currentFileName })
              : t("galleryBatchDeletePreparing")}
          </span>
        </div>
        <button className="secondary-action h-9" type="button" onClick={onCancel}>
          {t("galleryBatchDeleteCancel")}
        </button>
      </div>
      <div className="gallery-download-progress__bar" aria-label={t("galleryBatchDeleteOverall", { percent: overallPercent })}>
        <span style={{ width: `${overallPercent}%` }} />
      </div>
      <div className="gallery-download-progress__meta">
        <span>{t("galleryBatchDeleteOverall", { percent: overallPercent })}</span>
        <span>{t("galleryBatchDeleteProcessed", { count: processedCount, total: batchDelete.total })}</span>
        {batchDelete.failed > 0 ? <span>{t("galleryBatchDeleteFailedCount", { count: batchDelete.failed })}</span> : null}
      </div>
    </section>
  );
}

function FeaturedGalleryItem({
  copied,
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
  copied: boolean;
  deleting: boolean;
  expanded: boolean;
  isSelected: boolean;
  item: GalleryImageItem;
  onOpen: (item: GalleryImageItem) => void;
  onToggleSelected: (item: GalleryImageItem, shiftKey?: boolean) => void;
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
            copied={copied}
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
  copied,
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
  copied: boolean;
  deleting: boolean;
  expanded: boolean;
  isSelected: boolean;
  item: GalleryImageItem;
  onOpen: (item: GalleryImageItem) => void;
  onToggleSelected: (item: GalleryImageItem, shiftKey?: boolean) => void;
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
            copied={copied}
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
  onToggleSelected: (item: GalleryImageItem, shiftKey?: boolean) => void;
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
        onToggleSelected(item, event.shiftKey);
      }}
    >
      {isSelected ? <Check className="size-4" aria-hidden="true" /> : null}
    </button>
  );
}

function GalleryIconActions({
  copied,
  deleting,
  item,
  onCopy,
  onDelete,
  onDownload,
  onReuse
}: {
  copied: boolean;
  deleting: boolean;
  item: GalleryImageItem;
} & GalleryActionHandlers) {
  const { t } = useI18n();
  const excerpt = promptExcerpt(item.prompt);

  return (
    <div className="gallery-card__actions">
      <button
        aria-label={copied ? t("galleryCopiedPrompt") : t("galleryActionCopyPrompt", { excerpt })}
        className="gallery-icon-action"
        data-copied={copied}
        title={copied ? t("galleryCopiedPrompt") : t("galleryPromptLabel")}
        type="button"
        onClick={() => onCopy(item)}
      >
        <span className="gallery-icon-action__icon-stack" aria-hidden="true">
          <Copy className="gallery-icon-action__icon gallery-icon-action__icon--copy size-4" />
          <CheckCircle2 className="gallery-icon-action__icon gallery-icon-action__icon--check size-4" />
        </span>
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
  copied,
  deleting,
  item,
  onClose,
  onCopy,
  onDelete,
  onDownload,
  onReuse
}: {
  copied: boolean;
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
    <div className="gallery-modal-backdrop app-modal-backdrop" data-testid="gallery-detail" role="presentation">
      <div aria-labelledby="gallery-detail-title" aria-modal="true" className="gallery-modal app-modal-surface" role="dialog">
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
          <button
            aria-label={copied ? t("galleryCopiedPrompt") : t("commonCopy")}
            className="secondary-action gallery-copy-action h-10"
            data-copied={copied}
            title={copied ? t("galleryCopiedPrompt") : t("commonCopy")}
            type="button"
            onClick={onCopy}
          >
            <span className="gallery-icon-action__icon-stack" aria-hidden="true">
              <Copy className="gallery-icon-action__icon gallery-icon-action__icon--copy size-4" />
              <CheckCircle2 className="gallery-icon-action__icon gallery-icon-action__icon--check size-4" />
            </span>
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
    <div className="gallery-confirm-backdrop app-modal-backdrop" data-testid="gallery-delete-dialog" role="presentation">
      <div
        aria-describedby="gallery-delete-description"
        aria-labelledby="gallery-delete-title"
        aria-modal="true"
        className="gallery-confirm app-modal-surface"
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
    <div className="gallery-confirm-backdrop app-modal-backdrop" data-testid="gallery-batch-delete-dialog" role="presentation">
      <div
        aria-describedby="gallery-batch-delete-description"
        aria-labelledby="gallery-batch-delete-title"
        aria-modal="true"
        className="gallery-confirm app-modal-surface"
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

function triggerAssetDownload(asset: GeneratedAsset): void {
  triggerDownloadLink(`/api/assets/${encodeURIComponent(asset.id)}/download`, asset.fileName);
}

async function downloadAssetWithProgress(asset: GeneratedAsset, signal: AbortSignal, onProgress: (loaded: number, total: number | null) => void): Promise<void> {
  const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}/download`, { signal });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}.`);
  }

  const total = parseContentLength(response.headers.get("Content-Length"));
  const contentType = response.headers.get("Content-Type") ?? asset.mimeType;
  const fileName = responseDownloadFileName(response.headers.get("Content-Disposition"), asset.fileName);

  if (!response.body) {
    const blob = await response.blob();
    onProgress(blob.size, total ?? blob.size);
    triggerBlobDownload(blob, fileName);
    return;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(chunk);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  triggerBlobDownload(new Blob(chunks, { type: contentType }), fileName);
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownloadLink(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function triggerDownloadLink(href: string, fileName: string): void {
  const link = document.createElement("a");
  link.download = fileName;
  link.href = href;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function responseDownloadFileName(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) {
    return fallback;
  }

  const match = /filename="?([^";]+)"?/iu.exec(contentDisposition);
  return match?.[1] ? match[1] : fallback;
}

function waitForNextQueueItem(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeoutId);
        resolve();
      },
      { once: true }
    );
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
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
