import styles from '../App.module.css';
import { classNames } from '../classNames';
import {
  Bookmark,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  FolderOpen,
  Layers3,
  ListFilter,
  Maximize2,
  Minus,
  MousePointer2,
  PanelRight,
  Play,
  Plus,
  Scissors,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { pages, type LayoutId, type PageId } from '../workspace';

export interface ProjectSelection {
  name: string;
  path: string;
}

export function SourceRail({ project }: { project: ProjectSelection | null }) {
  return (
    <aside
      className={classNames(styles['source-rail'], styles['panel'])}
      aria-label="Project sources"
    >
      <div className={styles['panel-heading']}>
        <span>Project</span>
        <span className={styles['tiny-label']}>LOCAL</span>
      </div>
      <div className={styles['folder-root']}>
        <ChevronDown size={13} />
        <FolderOpen size={17} />
        <span>{project?.name ?? 'Untitled workspace'}</span>
      </div>
      <div className={styles['source-section']}>
        <span className={styles['section-label']}>COLLECTIONS</span>
        <div className={classNames(styles['collection-row'], styles['active'])}>
          <Layers3 size={16} />
          <span>Source recordings</span>
          <span className={styles['count']}>—</span>
        </div>
        <div className={styles['collection-row']}>
          <CheckCheck size={16} />
          <span>Reviewed clips</span>
          <span className={styles['count']}>—</span>
        </div>
        <div className={styles['collection-row']}>
          <Bookmark size={16} />
          <span>Saved selects</span>
          <span className={styles['count']}>—</span>
        </div>
      </div>
      <div className={styles['source-empty']}>
        <div className={styles['empty-mini-icon']}>
          <Folder size={23} strokeWidth={1.2} />
        </div>
        <p>Everything in its place.</p>
        <span>Your recordings and reviewed clips will appear here.</span>
      </div>
      <div className={styles['rail-footnote']}>
        <Circle size={7} fill="currentColor" />
        <span>{project ? 'Folder selected · media not loaded' : 'No project folder selected'}</span>
      </div>
    </aside>
  );
}

function Viewer({
  page,
  project,
  onChoose,
  choosing,
  compact = false,
}: {
  page: PageId;
  project: ProjectSelection | null;
  onChoose: () => void;
  choosing: boolean;
  compact?: boolean;
}) {
  const workspace = pages.find((item) => item.id === page)!;
  return (
    <section
      className={classNames(styles.viewer, styles.panel, compact && styles['viewer-compact'])}
      aria-label="Footage viewer"
    >
      <div className={styles['viewer-heading']}>
        <span className={styles['section-label']}>VIEWER</span>
        <span className={styles['viewer-state']}>No clip selected</span>
      </div>
      <div className={styles['viewer-surface']}>
        <div className={classNames(styles['viewer-corner'], styles['top-left'])} />
        <div className={classNames(styles['viewer-corner'], styles['top-right'])} />
        <div className={classNames(styles['viewer-corner'], styles['bottom-left'])} />
        <div className={classNames(styles['viewer-corner'], styles['bottom-right'])} />
        <div className={styles['viewer-empty']}>
          <div className={styles['viewer-emblem']}>
            <Brand />
          </div>
          {project && <p className={styles['eyebrow']}>{project.name}</p>}
          <h2>{compact ? 'Room for a closer look.' : workspace.phase}</h2>
          <p>
            {compact
              ? 'Select a clip to bring its preview and context into view.'
              : workspace.future}
          </p>
          {!compact && (
            <button className={styles['primary-button']} onClick={onChoose} disabled={choosing}>
              <FolderOpen size={17} />
              {choosing
                ? 'Opening folder picker…'
                : project
                  ? 'Change project folder'
                  : 'Choose project folder'}
            </button>
          )}
          {!compact && (
            <span className={styles['viewer-caption']}>
              {project
                ? 'Folder selected. Media intake is a later build stage.'
                : 'Choose a folder to set the workspace location.'}
            </span>
          )}
        </div>
      </div>
      <div
        className={styles['transport']}
        aria-label="Playback controls (available when media is supported)"
      >
        <span className={styles['timecode']}>00:00:00:00</span>
        <div className={styles['transport-actions']}>
          <button disabled aria-label="Previous clip">
            <SkipBack size={16} />
          </button>
          <button disabled aria-label="Play">
            <Play size={18} fill="currentColor" />
          </button>
          <button disabled aria-label="Next clip">
            <SkipForward size={16} />
          </button>
        </div>
        <div className={styles['transport-right']}>
          <button disabled aria-label="Audio monitoring">
            <Volume2 size={17} />
          </button>
          <button disabled aria-label="Expand viewer">
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}

function Timeline({ page }: { page: PageId }) {
  return (
    <section
      className={classNames(styles['timeline'], styles['panel'])}
      aria-label="Timeline placeholder"
    >
      <div className={styles['timeline-heading']}>
        <div className={styles['timeline-tools']}>
          <span className={styles['tool-highlight']}>
            <MousePointer2 size={16} />
          </span>
          <Scissors size={16} />
          <Bookmark size={16} />
          <span className={styles['tool-divider']} />
          <span>{page === 'selects' ? 'Selects timeline' : 'Source timeline'}</span>
        </div>
        <div className={styles['timeline-zoom']}>
          <Minus size={12} />
          <span />
          <Plus size={12} />
        </div>
      </div>
      <div className={styles['timeline-ruler']} aria-hidden="true">
        <span>00:00</span>
        <span>00:15</span>
        <span>00:30</span>
        <span>00:45</span>
        <span>01:00</span>
        <span>01:15</span>
      </div>
      <div className={styles['timeline-tracks']}>
        <div className={styles['track-labels']}>
          <span>VIDEO</span>
          <span>AUDIO</span>
        </div>
        <div className={styles['empty-tracks']}>
          <div />
          <div />
          <p>Ranges and markers will live here.</p>
        </div>
      </div>
      <div className={styles['timeline-footer']}>
        <span>NO SOURCE LOADED</span>
        <span>Keyframe cuts by default</span>
      </div>
    </section>
  );
}

function ContextPanel({ onNotes }: { onNotes: () => void }) {
  return (
    <aside
      className={classNames(styles['context-panel'], styles['panel'])}
      aria-label="Clip context"
    >
      <div className={styles['panel-heading']}>
        <span>Clip context</span>
        <PanelRight size={15} />
      </div>
      <div className={styles['context-body']}>
        <span className={styles['section-label']}>INTENT</span>
        <h3>Keep the why.</h3>
        <p>A cut can carry the reason you captured it. That context stays with the footage.</p>
        <div className={styles['intent-placeholder']}>
          <Bookmark size={18} />
          <span>Intent notes will appear here.</span>
        </div>
        <div className={styles['context-divider']} />
        <span className={styles['section-label']}>MARKERS</span>
        <div className={styles['context-empty']}>
          <span className={styles['marker-diamond']} />
          <p>
            Important moments,
            <br />
            kept in context.
          </p>
        </div>
      </div>
      <button className={styles['context-note-link']} onClick={onNotes}>
        Open workspace notes <ChevronRight size={15} />
      </button>
    </aside>
  );
}

function MediaCollection({
  page,
  project,
  onChoose,
  choosing,
}: {
  page: PageId;
  project: ProjectSelection | null;
  onChoose: () => void;
  choosing: boolean;
}) {
  const title =
    page === 'review' ? 'Review queue' : page === 'selects' ? 'Your selects' : 'Your footage';
  return (
    <section
      className={classNames(styles['media-collection'], styles['panel'])}
      aria-label="Footage collection"
    >
      <div className={styles['collection-heading']}>
        <div>
          <span className={styles['section-label']}>
            {page === 'review' ? 'HUMAN REVIEW' : 'PROJECT LIBRARY'}
          </span>
          <h2>{title}</h2>
        </div>
        <ListFilter size={18} />
      </div>
      <div className={styles['collection-empty']}>
        <div className={styles['collection-illustration']} aria-hidden="true">
          <div />
          <div />
          <div>
            <Layers3 size={31} strokeWidth={1} />
          </div>
        </div>
        <h3>Good footage deserves a home.</h3>
        <p>
          Bring your recordings, reviewed clips, and the context behind them into one workspace.
        </p>
        <button className={styles['primary-button']} onClick={onChoose} disabled={choosing}>
          <FolderOpen size={17} />
          {choosing
            ? 'Opening folder picker…'
            : project
              ? 'Change project folder'
              : 'Choose project folder'}
        </button>
        <span className={styles['viewer-caption']}>
          {project
            ? 'Folder selected. Media intake comes next.'
            : 'Media intake will be added in a later stage.'}
        </span>
      </div>
      <div className={styles['collection-table-head']} aria-hidden="true">
        <span>NAME</span>
        <span>DURATION</span>
        <span>STATUS</span>
      </div>
    </section>
  );
}

export function Workspace({
  layout,
  page,
  project,
  onChoose,
  choosing,
  onNotes,
  drawer,
}: {
  layout: LayoutId;
  page: PageId;
  project: ProjectSelection | null;
  onChoose: () => void;
  choosing: boolean;
  onNotes: () => void;
  drawer: ReactNode;
}) {
  const collectionPage = page === 'media' || page === 'library' || page === 'review';
  return (
    <div
      className={classNames(
        styles.workspace,
        styles[`workspace-${layout}`],
        Boolean(drawer) && styles['has-drawer'],
      )}
      data-layout={layout}
    >
      {layout !== 'focus' && <SourceRail project={project} />}
      <main
        className={classNames(
          styles['workspace-main'],
          layout === 'library' && styles['browser-workspace'],
        )}
        id="workspace"
        tabIndex={-1}
      >
        {layout === 'library' ? (
          <>
            <MediaCollection
              page={page}
              project={project}
              onChoose={onChoose}
              choosing={choosing}
            />
            <div className={styles['library-preview']}>
              <Viewer
                page={page}
                project={project}
                onChoose={onChoose}
                choosing={choosing}
                compact
              />
              <ContextPanel onNotes={onNotes} />
            </div>
          </>
        ) : (
          <>
            <Viewer page={page} project={project} onChoose={onChoose} choosing={choosing} />
            <Timeline page={page} />
          </>
        )}
        {collectionPage && layout !== 'library' && (
          <div className={styles['workspace-context-line']}>
            {page === 'media'
              ? 'Recording intake'
              : page === 'library'
                ? 'Approved footage'
                : 'Human review'}{' '}
            will be built here. Try the Library layout to compare a collection-first arrangement.
          </div>
        )}
      </main>
      {drawer ?? (layout === 'studio' ? <ContextPanel onNotes={onNotes} /> : null)}
    </div>
  );
}
