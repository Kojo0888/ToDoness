/** All visible text in one place (English only), ready for translation later. */
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

  nav: {
    lists: 'Lists',
    newList: 'New list name',
    addList: 'Add list',
    settings: 'Settings',
    admin: 'Admin',
    menu: 'Menu',
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
    priority: 'Priority',
    priorities: ['None', 'Low', 'Medium', 'High'] as const,
    list: 'List',
    delete: 'Delete task',
    close: 'Close',
    invalidTitle: 'The title cannot be empty.',
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
  },

  admin: {
    title: 'Users',
    email: 'E-mail',
    role: 'Role',
    status: 'Status',
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

  update: {
    available: 'A new version is available.',
    reload: 'Reload',
  },
} as const;
