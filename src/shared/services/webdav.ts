import { createClient, WebDAVClient, FileStat } from 'webdav';
import { CategoryFile } from '../types';

export class WebDAVError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'WebDAVError';
  }
}

export class WebDAVAuthError extends WebDAVError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR');
    this.name = 'WebDAVAuthError';
  }
}

export class WebDAVNetworkError extends WebDAVError {
  constructor(message: string = 'Network error') {
    super(message, 'NETWORK_ERROR');
    this.name = 'WebDAVNetworkError';
  }
}

class WebDAVService {
  private client: WebDAVClient | null = null;
  private config: {
    url: string;
    username: string;
    password: string;
    basePath: string;
  } | null = null;

  initClient(url: string, username: string, password: string, basePath: string = '/TabReminder/') {
    this.config = { url, username, password, basePath };
    this.client = createClient(url, {
      username,
      password,
    });
  }

  getClient(): WebDAVClient {
    if (!this.client) {
      throw new WebDAVError('WebDAV client not initialized');
    }
    return this.client;
  }

  async testConnection(): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.getDirectoryContents('/');
      return true;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new WebDAVAuthError('Invalid credentials');
      }
      throw new WebDAVNetworkError(`Connection failed: ${error.message}`);
    }
  }

  async ensureBasePath(basePath?: string): Promise<void> {
    const path = basePath || this.config?.basePath || '/TabReminder/';
    try {
      const client = this.getClient();
      const exists = await client.exists(path);
      if (!exists) {
        await client.createDirectory(path, { recursive: true });
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new WebDAVAuthError();
      }
      throw new WebDAVNetworkError(`Failed to create directory: ${error.message}`);
    }
  }

  async getFile(filename: string): Promise<CategoryFile | null> {
    try {
      const client = this.getClient();
      const basePath = this.config?.basePath || '/TabReminder/';
      const fullPath = `${basePath}${filename}`;

      const exists = await client.exists(fullPath);
      if (!exists) {
        return null;
      }

      const content = await client.getFileContents(fullPath, { format: 'text' });
      return JSON.parse(content as string);
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      if (error.response?.status === 401) {
        throw new WebDAVAuthError();
      }
      throw new WebDAVNetworkError(`Failed to get file: ${error.message}`);
    }
  }

  async putFile(filename: string, data: CategoryFile): Promise<void> {
    try {
      const client = this.getClient();
      const basePath = this.config?.basePath || '/TabReminder/';
      const fullPath = `${basePath}${filename}`;

      await this.ensureBasePath();

      const content = JSON.stringify(data, null, 2);
      await client.putFileContents(fullPath, content, { overwrite: true });
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new WebDAVAuthError();
      }
      throw new WebDAVNetworkError(`Failed to put file: ${error.message}`);
    }
  }

  async deleteFile(filename: string): Promise<void> {
    try {
      const client = this.getClient();
      const basePath = this.config?.basePath || '/TabReminder/';
      const fullPath = `${basePath}${filename}`;

      const exists = await client.exists(fullPath);
      if (exists) {
        await client.deleteFile(fullPath);
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new WebDAVAuthError();
      }
      throw new WebDAVNetworkError(`Failed to delete file: ${error.message}`);
    }
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      const client = this.getClient();
      const basePath = this.config?.basePath || '/TabReminder/';
      const fullPath = `${basePath}${filename}`;
      return await client.exists(fullPath);
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new WebDAVAuthError();
      }
      return false;
    }
  }

  async listCategoryFiles(): Promise<Array<{ filename: string; categoryId: string; categoryName: string }>> {
    try {
      const client = this.getClient();
      const basePath = this.config?.basePath || '/TabReminder/';

      await this.ensureBasePath();

      console.log('WebDAV: Listing files in', basePath);
      const contents = await client.getDirectoryContents(basePath) as FileStat[];
      console.log('WebDAV: Found', contents.length, 'items');
      
      const files: Array<{ filename: string; categoryId: string; categoryName: string }> = [];

      for (const item of contents) {
        console.log('WebDAV: Checking item', { 
          basename: item.basename, 
          filename: item.filename,
          type: item.type,
          startsWithTabreminder: item.basename.startsWith('tabreminder-'),
          endsWithJson: item.basename.endsWith('.json')
        });
        
        // Check basename, not full filename path
        if (item.type === 'file' && item.basename.startsWith('tabreminder-') && item.basename.endsWith('.json')) {
          try {
            const filename = item.basename;
            console.log('WebDAV: Reading category file', filename);
            const categoryFile = await this.getFile(filename);
            if (categoryFile) {
              console.log('WebDAV: Found category', {
                filename,
                categoryId: categoryFile.categoryId,
                categoryName: categoryFile.categoryName,
                noteCount: categoryFile.notes.length
              });
              files.push({
                filename,
                categoryId: categoryFile.categoryId,
                categoryName: categoryFile.categoryName,
              });
            } else {
              console.log('WebDAV: Category file is null', filename);
            }
          } catch (error) {
            console.error(`Failed to read file ${item.filename}:`, error);
          }
        }
      }

      console.log('WebDAV: Returning', files.length, 'category files');
      return files;
    } catch (error: any) {
      console.error('WebDAV: List files error', error);
      if (error.response?.status === 401) {
        throw new WebDAVAuthError();
      }
      throw new WebDAVNetworkError(`Failed to list files: ${error.message}`);
    }
  }

  sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  buildFilename(categoryId: string): string {
    return `tabreminder-${categoryId}.json`;
  }

  buildOldFilename(categoryName: string): string {
    const sanitized = this.sanitizeFilename(categoryName);
    return `tabreminder-${sanitized}.json`;
  }
}

export const webdavService = new WebDAVService();
