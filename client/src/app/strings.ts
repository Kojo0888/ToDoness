/** All visible text in one place (English only), ready for translation later. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** "a, b and c" / "a and b". */
const and = (parts: string[]) =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

interface KeptCounts {
  todos: number;
  lists: number;
  notes: number;
  plans?: number;
}

/** Notes and plans are only named when there are some. */
const extras = (c: { notes: number; plans?: number }) => [
  ...(c.notes > 0 ? [count(c.notes, 'note')] : []),
  ...((c.plans ?? 0) > 0 ? [count(c.plans ?? 0, 'plan')] : []),
];

/** What was kept offline. */
const kept = (c: KeptCounts) =>
  and([count(c.todos, 'task'), `${count(c.lists, 'list')} (besides the Inbox)`, ...extras(c)]);

export const t = {
  appName: 'ToDoness',
  loading: 'Loading…',

  login: {
    titleLogin: 'Log in',
    titleRegister: 'Create an account',
    email: 'E-mail',
    password: 'Password',
    submitLogin: 'Log in',
    submitRegister: 'Sign up',
    toRegister: 'No account yet? Sign up',
    toLogin: 'Already have an account? Log in',
    passwordHint: 'At least 8 characters.',
    resetHint: 'Did an admin reset your password? Type a new password here and it will be saved.',
    expired:
      'Your login is no longer valid. Log in again. The changes you made on this device are kept and will be sent.',
    loggedOut: 'You are logged out.',
    errors: {
      invalid_credentials: 'The e-mail or password is wrong.',
      invalid_request: 'Enter a valid e-mail and a password of at least 8 characters.',
      email_taken: 'This e-mail is already registered. Log in instead.',
      too_many_attempts: 'Too many attempts. Try again later.',
      cancelled: 'Cancelled.',
      server: 'The server had a problem. Try again in a moment.',
      network: 'Cannot reach the server. Check your connection.',
    },
  },

  offlineNoSession: {
    title: 'Connection needed',
    text: 'The first time you log in on a device, a connection to the server is needed.',
    retry: 'Try again',
  },

  initialSync: {
    loading: 'Loading your tasks…',
    offline:
      'Cannot reach the server. A connection is needed the first time you log in on a device.',
    server: 'The server had a problem. Try again in a moment.',
    retry: 'Try again',
  },

  recovery: {
    title: 'Offline data found',
    emptyAccount: (email: string, offline: KeptCounts) =>
      `Your new account is empty on the server, but ${kept(offline)} of ${email} are still stored offline on this device.`,
    filledAccount: (
      email: string,
      offline: KeptCounts,
      account: { todos: number; notes: number; plans?: number },
    ) =>
      `Your new account already holds ${and([count(account.todos, 'task'), ...extras(account)])}, and ${kept(offline)} of ${email} are still stored offline on this device.`,
    question: 'Would you like to push all offline data to the server?',
    attachments: 'Attachments are only stored on the server and cannot be restored.',
    no: 'No, discard it',
    yes: 'Yes, push it',
    noWarning: 'The offline data will be deleted from this device.',
    chooseTitle: 'Overwrite or append?',
    chooseText:
      'Append adds the offline data to what the account already holds. Overwrite deletes all tasks, lists, notes and plans the account holds now (only the empty Inbox list itself stays) and replaces them with the offline data.',
    append: 'Append',
    overwrite: 'Overwrite',
    back: 'Back',
    working: 'Pushing offline data…',
    errors: {
      no_inbox: 'The account is not ready yet. Try again in a moment.',
      failed: 'Something went wrong. The offline data is still kept. Try again.',
    },
  },

  modules: {
    label: 'Modules',
    tasks: 'Tasks',
    notes: 'Notes',
    plan: 'Plan',
  },

  nav: {
    main: 'Main',
    lists: 'Lists',
    newList: 'New list name',
    addList: 'Add list',
    manageLists: 'Manage lists',
    settings: 'Settings',
    admin: 'Admin',
    menu: 'Menu',
    publicLists: 'Public lists',
    publicNeedsConnection: 'Public lists need a connection the first time.',
  },

  manage: {
    title: 'Manage lists',
    empty: 'You have no lists besides the Inbox yet.',
    back: 'Back to tasks',
    drag: (name: string) => `Drag to reorder list: ${name}`,
    actions: (name: string) => `Actions: ${name}`,
    dragInstructions:
      'To reorder, press Space on the drag handle, move with the arrow keys, then press Space again to drop. Press Escape to cancel.',
    reorderFailed: 'Could not move the list: it was changed or deleted meanwhile. Try again.',
  },

  list: {
    addTask: 'Add a task',
    addTaskPlaceholder: 'Add a task and press Enter',
    empty: 'Nothing to do here.',
    completed: (n: number) => `Completed (${n})`,
    showCompleted: 'Show completed',
    hideCompleted: 'Hide completed',
    rename: 'Rename',
    renameLabel: 'List name',
    save: 'Save',
    cancel: 'Cancel',
    deleteList: 'Delete list',
    deleteListTitle: 'Delete this list?',
    deleteListText: (name: string, n: number) =>
      n === 0
        ? `The list "${name}" will be deleted.`
        : `The list "${name}" and its ${n} open and completed task${n === 1 ? '' : 's'} will be deleted.`,
    delete: 'Delete',
    notFound: 'This list does not exist.',
    movedTo: (name: string) => `Moved to ${name}.`,
    public: 'Public list',
    publicHint:
      'Public list: every user of the app can read and edit the tasks of this list. Only you can rename or delete it.',
  },

  publicPage: {
    by: (email: string) => `Public list by ${email}`,
    editable: 'Everyone can edit',
    addTaskPlaceholder: 'Add a task to this shared list and press Enter',
    empty: 'This list has no tasks.',
    gone: 'This list is not public any more, or it was deleted.',
    needsConnection:
      'This list is not on this device yet. Open it once while connected to the server.',
    offlineCopy: (when: string) =>
      `Offline copy from ${when}. Your changes are kept on this device and sent when the connection is back.`,
    pending: (n: number) => `${n} change${n === 1 ? '' : 's'} waiting to be sent.`,
    refused: (n: number) =>
      `${n} of your changes ${n === 1 ? 'was' : 'were'} not saved: it is not public any more, or the change was not allowed.`,
    dismiss: 'Dismiss',
    errors: {
      invalid: 'That change is not valid.',
    },
    ownerNote:
      'Changes you make here are sent to the server (later, if you are offline) and also appear for the owner.',
    back: 'Back to my tasks',
    due: (when: string) => `Due ${when}`,
    attachments: 'Attachments',
  },

  notes: {
    title: 'My notes',
    myNotes: 'My notes',
    publicNotes: 'Public notes',
    publicNeedsConnection: 'Public notes need a connection the first time.',
    newLabel: 'New note',
    newPlaceholder: 'Write a note…',
    add: 'Add note',
    addHint: 'Ctrl + Enter (⌘ + Enter on a Mac) adds the note.',
    empty: 'No notes yet. Write your first one above.',
    noteLabel: (n: number) => `Note ${n}`,
    changed: (when: string) => `Changed ${when}`,
    public: 'Public',
    publicHint:
      'Public note: every user of the app can read and edit its text. Only you can delete it or make it private.',
    delete: 'Delete',
    deleteLabel: (n: number) => `Delete note ${n}`,
    deleted: 'Note deleted.',
    drag: (n: number) => `Drag to reorder note ${n}`,
    search: 'Search notes',
    searchPlaceholder: 'Search notes',
    clearSearch: 'Clear',
    matches: (n: number, total: number) =>
      `${n} of ${total} note${total === 1 ? '' : 's'} match${n === 1 ? 'es' : ''}.`,
    noMatches: 'No notes match.',
    dragOffWhileSearching: 'Clear the search to reorder notes.',
    saveFailed: 'Could not save this note.',
    tooLong: 'A note can have at most 20 000 characters.',
    publicPage: {
      title: 'Public notes',
      intro:
        'Notes other users made public. Everyone can edit them, also offline: changes are sent when the server can be reached.',
      by: (email: string) => `By ${email}`,
      noteLabel: (email: string) => `Public note by ${email}`,
      empty: 'Nobody has made a note public yet.',
      needsConnection:
        'Public notes are not on this device yet. Open them once while connected to the server.',
    },
  },

  managePlans: {
    title: 'Manage plans',
    empty: 'You have no plans yet.',
    back: 'Back to plans',
    drag: (name: string) => `Drag to reorder plan: ${name}`,
    reorderFailed: 'Could not move the plan: it was changed or deleted meanwhile. Try again.',
  },

  plan: {
    plans: 'Plans',
    managePlans: 'Manage plans',
    newPlan: 'New plan name',
    addPlan: 'Add plan',
    empty: 'No plans yet.',
    firstPlan: 'Name of your first plan',
    createPlan: 'Create plan',
    nameLabel: 'Plan name',
    deletePlan: 'Delete plan',
    deletePlanTitle: 'Delete this plan?',
    deletePlanText: (name: string, n: number) =>
      n === 0
        ? `The plan "${name}" will be deleted.`
        : `The plan "${name}" and its ${n} activit${n === 1 ? 'y' : 'ies'} will be deleted.`,
    addActivity: 'Add an activity',
    addActivityPlaceholder: 'Add an activity and press Enter',
    addActivityButton: 'Add activity',
    noActivities: 'No activities yet. Add the first one above.',
    names: 'Activity names',
    nameModes: { on: 'On block', after: 'After block', column: 'Column' },
    timeline: 'Timeline',
    activityColumn: 'Activity',
    today: 'Today',
    block: (name: string, start: string, end: string) => `${name}, ${start} – ${end}`,
    moveHandle: (name: string) => `Move ${name}`,
    endHandle: (name: string) => `Change the end of ${name}`,
    arrow: (from: string, to: string) => `${from} → ${to}, remove link`,
    linking: (from: string, to: string) => `Release to link: ${to} starts after ${from}.`,
    blockHelp:
      'Arrow keys move the activity by a day, Shift + arrow keys change its duration, Delete removes it. Dragging an end onto another activity links the two.',
    undo: 'Undo last change',
    startsAfter: 'Starts after',
    startsAfterAdd: 'Add…',
    selected: 'Selected activity',
    activityName: 'Activity name',
    start: 'Start',
    end: 'End',
    days: (n: number) => `${n} day${n === 1 ? '' : 's'}`,
    deleteActivity: 'Delete activity',
    done: 'Done',
    activityDeleted: 'Activity deleted.',
    loop: 'That link would make a loop: the two activities would wait for each other.',
    failed: 'That change could not be made.',
  },

  todo: {
    markDone: (title: string) => `Mark "${title}" as done`,
    markOpen: (title: string) => `Mark "${title}" as not done`,
    deleted: 'Task deleted.',
    undo: 'Undo',
    detail: 'Task details',
    title: 'Title',
    notes: 'Notes',
    dueDate: 'Due date',
    dueTime: 'Time (optional)',
    timeClear: 'Clear time',
    timeClearShort: 'Clear',
    timePresets: 'Suggested times',
    remind: 'Remind me',
    reminders: {
      week: '1 week before',
      day: '1 day before',
      hour: '1 hour before',
    },
    remindNeedsDue: 'Set a due date to get a reminder.',
    remindHints: {
      insecure:
        'Notifications need a secure connection (HTTPS). Reminders will only appear inside the app.',
      unsupported:
        'This browser cannot show notifications. Reminders will only appear inside the app.',
      denied:
        'Notifications are blocked for this site in your browser. Reminders will only appear inside the app.',
      default: 'Your browser will ask for permission to show notifications.',
      granted: 'You will get a notification, also when the app is closed if push is on.',
    },
    priority: 'Priority',
    priorities: ['None', 'Low', 'Medium', 'High'] as const,
    list: 'List',
    delete: 'Delete task',
    close: 'Close',
    invalidTitle: 'The title cannot be empty.',
    drag: (title: string) => `Drag to reorder: ${title}`,
    dragInstructions:
      'To reorder, press Space on the drag handle, move with the arrow keys, then press Space again to drop. Press Escape to cancel. To move a task to another list, use the List field in its details.',
    dragStart: (title: string) => `Picked up ${title}.`,
    dragOver: (title: string, position: number, total: number) =>
      `${title} is now at position ${position} of ${total}.`,
    dragOverList: (title: string, list: string) => `${title} is over the list ${list}.`,
    dragDropped: (title: string) => `Dropped ${title}.`,
    dragCancelled: (title: string) => `Cancelled. ${title} was not moved.`,
  },

  attachments: {
    title: 'Attachments',
    add: 'Add files',
    pick: {
      files: 'Add files',
      media: 'Add photos or videos',
      documents: 'Add documents',
    },
    none: 'No attachments.',
    remove: (name: string) => `Remove ${name}`,
    removeLabel: 'Remove',
    download: (name: string) => `Download ${name}`,
    tooLarge: (name: string, max: string) => `${name} is larger than the limit of ${max}.`,
    empty: (name: string) => `${name} is empty.`,
    maxSize: (max: string) => `Up to ${max} per file.`,
    uploading: (name: string) => `Uploading ${name}…`,
    needsConnection: 'Attachments need a connection to the server.',
    loadFailed: 'Could not load the attachments.',
    removeFailed: 'Could not remove the attachment.',
    errors: {
      too_large: 'The file is larger than the server allows.',
      not_found: 'The task is not on the server yet. Wait for the sync and try again.',
      unauthorized: 'Your login is no longer valid. Log in again.',
      forbidden: 'Only the owner can add files.',
      invalid: 'The server did not accept this file.',
      server: 'The server had a problem. Try again in a moment.',
      network: 'Cannot reach the server. Check your connection.',
      cancelled: 'Upload cancelled.',
    },
  },

  syncDiag: {
    title: 'Sync diagnostics (admin)',
    toggle: 'Sync diagnostics',
    browser: 'Browser says',
    app: 'App found',
    check: 'Last check',
    checkTook: 'Check took',
    answered: 'answered',
    noAnswer: 'no answer',
    ago: 'ago',
    online: 'online',
    offline: 'offline',
    sync: 'Sync',
    request: 'Request',
    none: '–',
    waiting: (what: string, s: string) => `${what} waiting ${s}`,
    last: (what: string, ms: string, outcome: string) => `${what} ${ms}, ${outcome}`,
    nextTry: 'Next try',
    timer: 'timer',
    reconnect: 'Online event → saved',
    outage: 'Outage (first failure → saved)',
    showLog: 'Log',
    hideLog: 'Hide log',
    closeLog: 'Close log',
    logTitle: 'Sync log (newest first)',
    empty: 'Nothing yet.',
    showQueue: 'Queued changes',
    closeQueue: 'Close queued changes',
    queueTitle: 'Queued changes (raw)',
    queueHint: 'Changes on this device not yet accepted by the server, exactly as stored.',
    states: {
      idle: 'idle',
      syncing: 'syncing',
      offline: 'offline',
      error: 'error',
      auth_required: 'login needed',
    },
  },

  sync: {
    offline: 'Offline',
    syncing: 'Syncing…',
    saved: 'All changes saved',
    pending: (n: number) => `${n} change${n === 1 ? '' : 's'} pending`,
    problem: 'Sync problem, retrying',
  },

  settings: {
    title: 'Settings',
    account: 'Account',
    theme: 'Theme',
    themes: { system: 'Follow system', light: 'Light', dark: 'Dark' },
    logout: 'Log out',
    push: {
      title: 'Push notifications',
      text: 'Get reminders as notifications even when the app is closed.',
      status: {
        unsupported: 'Not available: this browser does not support web push.',
        insecure: 'Not available: push needs a secure connection (HTTPS).',
        denied: 'Blocked in your browser settings for this site.',
        off: 'Off on this device.',
        on: 'On for this device.',
      },
      enable: 'Turn on push',
      disable: 'Turn off push',
      failed:
        'Could not turn push on. The browser or the server could not set it up; try again later.',
      hint: 'Needs a connection to the server, and the server must be able to reach your browser’s push service.',
    },
    ntfy: {
      title: 'Reminders through ntfy',
      text: 'Get reminders in the ntfy app on your phone or computer. Works next to web push, and also on a network without internet if your server runs its own ntfy.',
      topicLabel: 'Your topic',
      generate: 'Generate a private topic',
      save: 'Save',
      saving: 'Saving…',
      remove: 'Turn off',
      test: 'Send a test notification',
      testing: 'Sending…',
      subscribe: (address: string) => `In the ntfy app, subscribe to: ${address}`,
      active: 'On: reminders are also published to your topic.',
      inactive: 'Off.',
      saved: 'Saved.',
      removed: 'Turned off.',
      testSent: 'Sent. It should show up in the ntfy app in a moment.',
      error: {
        invalid: 'A topic has 1 to 64 letters, digits, "-" or "_".',
        taken: 'This topic is already used by someone else. Pick another one.',
        disabled: 'ntfy is not switched on on this server.',
        failed: 'Could not do that. Check the connection and try again.',
        noTopic: 'Save a topic first.',
        rateLimited: 'Please wait a few seconds before sending another test.',
        testFailed:
          'The server could not reach the ntfy server. Check NTFY_URL and the server’s network.',
      },
      hint: 'On a shared ntfy server anyone who knows your topic can read your reminders: keep it secret.',
    },
    notifications: {
      title: 'Notifications',
      enable: 'Enable notifications',
      status: {
        insecure: 'Not available: notifications need a secure connection (HTTPS).',
        unsupported: 'Not available: this browser cannot show notifications.',
        denied: 'Blocked in your browser settings for this site.',
        default: 'Not enabled yet.',
        granted: 'Enabled.',
      },
      hint: 'Reminders only appear while the app is open (in a tab or installed).',
    },
    password: {
      title: 'Change password',
      current: 'Current password',
      next: 'New password',
      repeat: 'Repeat the new password',
      submit: 'Change password',
      working: 'Changing…',
      hint: 'At least 8 characters. You stay logged in here; your other devices are logged out.',
      mismatch: 'The two new passwords are not the same.',
      done: 'Password changed. Your other devices were logged out.',
      needsConnection: 'Changing the password needs a connection to the server.',
      errors: {
        wrong_password: 'The current password is wrong.',
        invalid_request: 'The new password must have at least 8 characters.',
        too_many_attempts: 'Too many attempts. Try again later.',
        unauthorized: 'Your login is no longer valid. Log in again.',
        server: 'The server had a problem. Try again in a moment.',
        network: 'Cannot reach the server. Check your connection.',
      },
    },
  },

  admin: {
    title: 'Users',
    email: 'E-mail',
    role: 'Role',
    status: 'Status',
    online: 'Online',
    isOnline: 'Online',
    isOffline: 'Offline',
    lastSeen: (when: string) => `Last seen ${when}`,
    neverSeen: 'Never seen',
    reset: 'Reset password',
    resetPending: 'Password reset, waiting for next login',
    active: 'Active',
    resetTitle: 'Reset this password?',
    resetText: (email: string) =>
      `${email} will be logged out everywhere. At the next login, the password they type becomes their new password.`,
    resetDone: (email: string) => `Password of ${email} was reset.`,
    needsConnection: 'The admin screen needs a connection to the server.',
    loadFailed: 'Could not load the users.',
  },

  reminder: {
    label: 'Reminder',
    open: 'Open',
    dismiss: 'Dismiss',
    region: 'Reminders',
  },

  update: {
    available: 'A new version is available.',
    reload: 'Reload',
  },
} as const;
