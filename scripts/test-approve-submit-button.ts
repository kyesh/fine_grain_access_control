/**
 * Component test for the approve-page submit button's pending guard
 * (src/app/dashboard/approve/ApproveSubmitButton.tsx).
 * Run: npx tsx scripts/test-approve-submit-button.ts  (part of `npm run mcp:lint`)
 *
 * Why this exists: FileApprovalFlow shipped a plain <button type="submit">
 * with no pending state. React 19 queues every submit while the server action
 * is in flight, so rage-clicking a slow file-grant approval produced up to 20
 * approval_link_approved events and 11 duplicate rules for ONE link (PostHog,
 * production, 2026-08-30 → 2026-09-04). This pins the guard: while the form
 * action is unresolved the button is disabled and reads "Approving…", for
 * every label the approve page renders it with.
 *
 * Renders with happy-dom + react-dom/client under React's act() — no browser.
 */
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/' });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLButtonElement',
  'HTMLInputElement', 'HTMLIFrameElement', 'Node', 'Element', 'Event', 'MouseEvent', 'SubmitEvent', 'MutationObserver', 'getComputedStyle', 'FormData']) {
  Object.defineProperty(g, k, { value: (win as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
}
g.IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

async function main() {
  const React = await import('react');
  const { act, createElement: h } = React;
  const { createRoot } = await import('react-dom/client');
  const { ApproveSubmitButton } = await import('../src/app/dashboard/approve/ApproveSubmitButton');

  async function scenario(label: string | undefined, expectedIdle: string) {
    console.log(`\n${label ? `label="${label}"` : 'default label'}`);
    let release: () => void = () => {};
    let calls = 0;
    const action = () => { calls++; return new Promise<void>(r => { release = r; }); };

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(h('form', { action }, h(ApproveSubmitButton, label ? { label } : {})));
    });
    const button = container.querySelector('button') as unknown as HTMLButtonElement;
    const form = container.querySelector('form') as unknown as HTMLFormElement;
    check('renders idle label', button.textContent === expectedIdle);
    check('idle button is enabled', !button.disabled);

    // First submit: action starts, button must lock.
    await act(async () => { form.requestSubmit(); });
    check('action invoked once', calls === 1);
    check('pending button is disabled', button.disabled === true);
    check('pending label reads "Approving…"', button.textContent === 'Approving…');

    // A second click while pending must be inert (disabled buttons don't submit).
    await act(async () => { button.click(); });
    check('click while pending does not re-run the action', calls === 1);

    await act(async () => { release(); });
    check('button re-enables after the action settles', !button.disabled);
    check('idle label restored', button.textContent === expectedIdle);

    await act(async () => { root.unmount(); });
    container.remove();
  }

  await scenario(undefined, 'Approve this grant');
  await scenario('Grant access to what I picked', 'Grant access to what I picked');

  // Control: the shape FileApprovalFlow shipped with (a plain submit button)
  // lets every click through — React queues each submit behind the pending
  // action, which is the N-clicks → N-server-actions mechanism behind the
  // production duplicates. If this control ever passes with calls === 1,
  // the guard scenarios above are no longer proving anything.
  console.log('\ncontrol: unguarded submit button');
  {
    let calls = 0;
    const action = () => { calls++; return new Promise<void>(() => {}); };
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(h('form', { action }, h('button', { type: 'submit' }, 'Approve this grant')));
    });
    const form = container.querySelector('form') as unknown as HTMLFormElement;
    const button = container.querySelector('button') as unknown as HTMLButtonElement;
    await act(async () => { form.requestSubmit(); });
    await act(async () => { button.click(); });
    await act(async () => { button.click(); });
    check('three clicks on an unguarded button dispatch three actions', calls === 3);
    await act(async () => { root.unmount(); });
    container.remove();
  }
}

main().then(() => {
  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll approve-submit-button checks passed');
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
