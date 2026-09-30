import { ChevronDown, FolderOpen } from 'lucide-react';
import { Button } from './ui';
import { sourceFolders, type SourceFolder } from './sourceFolderTree';
import type { Recording } from './model';
import s from './Workflow.module.css';

export function SourceFolders({
  recordings,
  selected,
  onSelect,
}: {
  recordings: Recording[];
  selected: string;
  onSelect: (path: string) => void;
}) {
  function folder(node: SourceFolder) {
    const button = (
      <Button
        className={s.sourceFolderButton}
        title={node.path}
        aria-label={`Source folder: ${node.path}`}
        aria-pressed={selected.toLowerCase() === node.path.toLowerCase()}
        onClick={(e) => {
          e.preventDefault();
          onSelect(node.path);
        }}
      >
        <FolderOpen size={14} />
        <span>{node.label}</span>
        <small>{node.total}</small>
      </Button>
    );
    return node.children.length ? (
      <details key={node.path} open className={s.sourceFolder}>
        <summary>
          <ChevronDown size={12} />
          {button}
        </summary>
        <div>{node.children.map(folder)}</div>
      </details>
    ) : (
      <div className={s.sourceFolder} key={node.path}>
        {button}
      </div>
    );
  }
  return <div aria-label="Source folders">{sourceFolders(recordings).map(folder)}</div>;
}
