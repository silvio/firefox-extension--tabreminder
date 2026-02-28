import '@testing-library/jest-dom';

// Mock browser API
const browserMock = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn(),
    onAlarm: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  tabs: {
    query: jest.fn(),
    get: jest.fn(),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onActivated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  notifications: {
    create: jest.fn(),
    clear: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  browserAction: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
  },
  runtime: {
    sendMessage: jest.fn(),
    getURL: jest.fn((path: string) => path),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onInstalled: {
      addListener: jest.fn(),
    },
  },
  i18n: {
    getMessage: jest.fn((key: string) => key),
  },
};

(global as any).browser = browserMock;
(global as any).chrome = browserMock;

// Mock webextension-polyfill
jest.mock('webextension-polyfill', () => browserMock);

// Mock webdav client package (ESM in node_modules)
jest.mock('webdav', () => ({
  createClient: jest.fn(() => ({
    getDirectoryContents: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(false),
    createDirectory: jest.fn().mockResolvedValue(undefined),
    getFileContents: jest.fn().mockResolvedValue(''),
    putFileContents: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  })),
}));
