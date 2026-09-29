import styles from './App.module.css';
import { classNames } from './classNames';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  FolderOpen,
  LayoutDashboard,
  MessageSquare,
  NotebookPen,
  Sparkles,
  X,
} from 'lucide-react';
import { Brand } from './components/Brand';
import { Dialog } from './components/Dialog';
import { LayoutPicker } from './components/LayoutPicker';
import { Workspace, type ProjectSelection } from './components/Workspace';
import { layouts, pages, preferenceKey, readPreferences, type LayoutId } from './workspace';

const notesKey = 'virtual-cut.scratchpad.v1';
type Drawer = 'notes' | 'agent' | null;

export function App() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [project, setProject] = useState<ProjectSelection | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [dialog, setDialog] = useState<'layouts' | 'about' | null>(null);
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<'copilot' | 'agent'>('copilot');
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(notesKey) ?? '';
    } catch {
      return '';
    }
  });
  const [notesSaved, setNotesSaved] = useState(true);
  const notesTrigger = useRef<HTMLButtonElement>(null);
  const agentTrigger = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);

  const page = pages.find((item) => item.id === preferences.page)!;
  const layout = layouts.find((item) => item.id === preferences.layout)!;

  useEffect(() => {
    window.virtualCut
      ?.getAppInfo()
      .then((info) => setVersion(info.version))
      .catch(() => setNotice('App information is unavailable. The workspace is still usable.'));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    } catch {
      setNotice('Layout preferences could not be saved on this device.');
    }
  }, [preferences]);

  useEffect(() => {
    try {
      localStorage.setItem(notesKey, notes);
      setNotesSaved(true);
    } catch {
      setNotesSaved(false);
    }
  }, [notes]);

  useEffect(() => {
    if (drawer) drawerClose.current?.focus();
  }, [drawer]);

  async function chooseFolder() {
    if (!window.virtualCut) {
      setNotice('Open the desktop app to choose a local project folder.');
      return;
    }
    setChoosing(true);
    try {
      const selection = await window.virtualCut.selectProjectFolder();
      if (selection) {
        setProject(selection);
        setNotice(`Workspace location: ${selection.path}`);
      }
    } catch {
      setNotice('The folder picker could not open. Please try again.');
    } finally {
      setChoosing(false);
    }
  }

  function closeDrawer() {
    const trigger = drawer === 'notes' ? notesTrigger : agentTrigger;
    setDrawer(null);
    trigger.current?.focus();
  }

  function selectLayout(selected: LayoutId) {
    setPreferences((current) => ({ ...current, layout: selected }));
  }

  const drawerContent = drawer && (
    <aside
      className={classNames(styles['shared-drawer'], styles['panel'])}
      aria-label={drawer === 'notes' ? 'Workspace notes' : 'Agent panel'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeDrawer();
        }
      }}
    >
      <div className={styles['drawer-heading']}>
        <div className={styles['drawer-tabs']} role="group" aria-label="Context panel">
          <button aria-pressed={drawer === 'notes'} onClick={() => setDrawer('notes')}>
            <NotebookPen size={15} />
            Notes
          </button>
          <button aria-pressed={drawer === 'agent'} onClick={() => setDrawer('agent')}>
            <Sparkles size={15} />
            Agent
          </button>
        </div>
        <button
          ref={drawerClose}
          className={styles['icon-button']}
          onClick={closeDrawer}
          aria-label="Close side panel"
        >
          <X size={17} />
        </button>
      </div>
      {drawer === 'notes' ? (
        <div className={styles['notes-panel']}>
          <p className={styles['eyebrow']}>WORKSPACE SCRATCHPAD</p>
          <h2>Keep a thought close.</h2>
          <p className={styles['drawer-description']}>
            Jot down an idea while you explore. Clip-linked notes will come later.
          </p>
          <label className={styles['sr-only']} htmlFor="workspace-notes">
            Workspace notes
          </label>
          <textarea
            id="workspace-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="An idea, a question, a moment to come back to…"
          />
          <div
            className={classNames(styles['notes-save-state'], !notesSaved && styles['save-error'])}
            role="status"
          >
            {notesSaved ? <Check size={13} /> : <CircleHelp size={13} />}
            {notesSaved
              ? 'Saved on this device · shared across workspaces'
              : 'Not saved. Copy your notes before closing.'}
          </div>
        </div>
      ) : (
        <div className={styles['agent-panel']}>
          <div className={styles['agent-mode']} role="group" aria-label="Agent mode">
            <button aria-pressed={agentMode === 'copilot'} onClick={() => setAgentMode('copilot')}>
              Copilot
            </button>
            <button aria-pressed={agentMode === 'agent'} onClick={() => setAgentMode('agent')}>
              Agent mode
            </button>
          </div>
          <div className={styles['agent-empty']}>
            <span className={styles['agent-glyph']}>
              <Sparkles size={24} strokeWidth={1.4} />
            </span>
            <span className={styles['pill']}>PLANNED</span>
            <h2>
              {agentMode === 'copilot' ? 'A second set of eyes.' : 'A hand with the whole batch.'}
            </h2>
            <p>
              {agentMode === 'copilot'
                ? 'Ask about a moment. Refine a marker. Think through a cut with the context beside you.'
                : 'Set the intent for a batch. Review the proposed cuts, names, and markers before they enter your library.'}
            </p>
          </div>
          <div className={styles['agent-status']}>
            <MessageSquare size={16} />
            <span>Agent connection comes in a later build stage.</span>
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <div className={styles['app-shell']}>
      <a className={styles['skip-link']} href="#workspace">
        Skip to workspace
      </a>
      <header className={styles['app-header']}>
        <div className={styles['wordmark']}>
          <span className={styles['brand-box']}>
            <Brand />
          </span>
          <span>
            Virtual <strong>Cut</strong>
          </span>
        </div>
        <span className={styles['header-divider']} />
        <button
          className={styles['project-picker']}
          onClick={chooseFolder}
          disabled={choosing}
          title={project?.path ?? 'Choose a project folder'}
          aria-label={project ? `Change project folder: ${project.name}` : 'Select project folder'}
        >
          <FolderOpen size={17} />
          <span>{project?.name ?? 'No project selected'}</span>
          <ChevronDown size={13} />
        </button>
        <div className={styles['header-actions']}>
          <button
            className={classNames(styles['header-button'], styles['layouts-button'])}
            onClick={() => setDialog('layouts')}
          >
            <LayoutDashboard size={16} />
            <span>Layouts</span>
            <span className={styles['button-count']}>3</span>
          </button>
          <span className={styles['header-divider']} />
          <button
            ref={notesTrigger}
            className={classNames(styles['header-button'], drawer === 'notes' && styles.active)}
            aria-expanded={drawer === 'notes'}
            onClick={() => setDrawer(drawer === 'notes' ? null : 'notes')}
          >
            <NotebookPen size={16} />
            <span>Notes</span>
          </button>
          <button
            ref={agentTrigger}
            className={classNames(styles['header-button'], drawer === 'agent' && styles.active)}
            aria-expanded={drawer === 'agent'}
            onClick={() => setDrawer(drawer === 'agent' ? null : 'agent')}
          >
            <Sparkles size={16} />
            <span>Agent</span>
          </button>
        </div>
      </header>
      <div className={styles['workspace-heading']}>
        <div className={styles['workspace-title']}>
          <h1>{page.label}</h1>
          <span className={styles['heading-slash']}>/</span>
          <p>{page.description}</p>
        </div>
        <div className={styles['workspace-meta']}>
          <span className={styles['preview-label']}>Workspace preview</span>
          <span className={styles['meta-dot']}>·</span>
          <button className={styles['layout-current']} onClick={() => setDialog('layouts')}>
            {layout.name}
            <ChevronDown size={12} />
          </button>
        </div>
      </div>
      <Workspace
        layout={preferences.layout}
        page={preferences.page}
        project={project}
        onChoose={chooseFolder}
        choosing={choosing}
        onNotes={() => setDrawer('notes')}
        drawer={drawerContent}
      />
      {notice && (
        <div className={styles['notice']} role="status">
          <span>{notice}</span>
          <button
            className={styles['icon-button']}
            aria-label="Dismiss message"
            onClick={() => setNotice('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <footer className={styles['page-strip']}>
        <div aria-hidden="true" />
        <nav aria-label="Workspace pages">
          {pages.map((item) => (
            <button
              key={item.id}
              aria-current={item.id === preferences.page ? 'page' : undefined}
              onClick={() => setPreferences((current) => ({ ...current, page: item.id }))}
            >
              <item.icon size={20} strokeWidth={1.5} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className={styles['footer-right']}>
          <span>Foundation</span>
          <button
            className={styles['icon-button']}
            onClick={() => setDialog('about')}
            aria-label="About Virtual Cut"
          >
            <CircleHelp size={17} />
          </button>
        </div>
      </footer>
      {dialog === 'layouts' && (
        <LayoutPicker
          selected={preferences.layout}
          onSelect={selectLayout}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'about' && (
        <Dialog
          title="Virtual Cut"
          eyebrow="ABOUT THE APP"
          onClose={() => setDialog(null)}
          className={styles['about-dialog']}
        >
          <p className={styles['dialog-description']}>
            One home for footage, context, and your next edit.
          </p>
          <div className={styles['about-version']}>
            <Brand />
            <div>
              <strong>Desktop foundation</strong>
              <span>{version ? `Version ${version}` : 'Development preview'}</span>
            </div>
          </div>
          <h3>Ready to explore</h3>
          <p>
            Switch pages and layouts, choose a workspace folder, and keep scratch notes on this
            device.
          </p>
          <h3>Coming in later stages</h3>
          <p>
            Media intake, playback, cutting, marker publishing, review, local transcription, and
            agent integration.
          </p>
          <div className={styles['about-note']}>
            <ArrowUpRight size={16} />
            <span>
              Choosing a folder only sets this session’s location. It does not scan, import, or
              change your footage.
            </span>
          </div>
        </Dialog>
      )}
    </div>
  );
}
