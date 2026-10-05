import s from './Workflow.module.css';

/** Help in the bottom bar (VC-93). One topic for now: spoken cues, from the cue rules in
 * electron/transcript-edits.ts. Opening it loads nothing: no speech engine, no model. */
const cues = [
  [
    'Marker',
    'A point marker where you said "Marker". The words after it become its title.',
    '"Marker. Cai\'s reaction when the gate opens."',
  ],
  [
    'Note',
    'A timed note holding the words that follow.',
    '"Note. The enemy placement is teaching this mechanic."',
  ],
  ['Split', 'A split of the clip at that point.', '"Split."'],
  [
    'Clip start · Clip end',
    'One clip from the start cue to the end cue. "Clip in" and "Clip out" work too.',
    '"Clip start." … "Clip end."',
  ],
];

export function HelpContent() {
  return (
    <div className={s.help} data-help>
      <h3>Spoken cues</h3>
      <p>
        Say a cue word at the start of a phrase on your microphone track. After you transcribe the
        microphone, each cue appears as a proposal in the transcript window. Nothing changes until
        you accept it.
      </p>
      <table className={s.shortcutTable}>
        <thead>
          <tr>
            <th scope="col">Say</th>
            <th scope="col">Proposes</th>
            <th scope="col">Example</th>
          </tr>
        </thead>
        <tbody>
          {cues.map(([cue, proposes, example]) => (
            <tr key={cue}>
              <th scope="row">{cue}</th>
              <td>{proposes}</td>
              <td className={s.muted}>{example}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Reviewing a proposal</h3>
      <ul>
        <li>
          Open the transcript window and choose the microphone transcript. Each proposal has Accept
          and Reject.
        </li>
        <li>Listen first, and adjust the position if the cue landed early or late.</li>
        <li>Edit the title, and choose how much of the speech that follows to keep as context.</li>
        <li>
          A Clip start and Clip end are reviewed together. Accepting creates one clip and approves
          both.
        </li>
      </ul>
      <h3>Good to know</h3>
      <ul>
        <li>Only the microphone track is checked. Game dialogue is never scanned for cues.</li>
        <li>Start the phrase with the cue: "I might split this later" isn't a cue.</li>
        <li>
          Recognition can mishear a cue, for example "Note" as "no". Correct the transcript; the
          original recognition is kept.
        </li>
        <li>Proposals never apply on their own.</li>
        <li>
          The older words Mark and Cut still work. Marker and Split are preferred because they come
          up less in normal speech.
        </li>
      </ul>
      <p className={s.muted}>Fullscreen: F11, listed under Keyboard shortcuts.</p>
    </div>
  );
}
