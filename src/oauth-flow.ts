import * as http from 'http';
import * as url from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface OAuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  subscription: string;
  expiresIn: number;
}

/**
 * Browser-based OAuth flow for web connector
 * Opens browser for authentication and receives callback
 */
export class BrowserOAuthFlow {
  private baseUrl = 'https://aidd-backend-prod-739193356129.us-central1.run.app';
  private callbackPort = 8765;
  private server?: http.Server;

  /**
   * Initiate browser-based OAuth flow
   * Opens browser for user to authenticate
   * Returns auth tokens when user completes sign-in
   */
  async authenticate(provider?: 'google' | 'microsoft' | 'apple'): Promise<OAuthResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error('Authentication timeout - user did not complete sign-in'));
      }, 300000); // 5 minute timeout

      // Create local callback server
      this.server = http.createServer(async (req, res) => {
        try {
          const parsedUrl = url.parse(req.url || '', true);
          const query = parsedUrl.query;

          if (parsedUrl.pathname === '/oauth/callback') {
            // Received OAuth callback
            const { accessToken, refreshToken, userId, email, subscription, expiresIn, error } = query;

            if (error) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body>
                    <h2>❌ Authentication Failed</h2>
                    <p>${error}</p>
                    <p>You can close this window now.</p>
                  </body>
                </html>
              `);
              clearTimeout(timeout);
              this.cleanup();
              reject(new Error(error as string));
              return;
            }

            if (accessToken && refreshToken && userId) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: system-ui, -apple-system, sans-serif; padding: 40px; text-align: center;">
                    <h2>✅ Authentication Successful!</h2>
                    <p>You're now connected to AiDD.</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Subscription:</strong> ${subscription || 'FREE'}</p>
                    <p>You can close this window now and return to Claude.</p>
                  </body>
                </html>
              `);

              clearTimeout(timeout);
              this.cleanup();

              resolve({
                accessToken: accessToken as string,
                refreshToken: refreshToken as string,
                userId: userId as string,
                email: email as string,
                subscription: (subscription as string) || 'FREE',
                expiresIn: parseInt(expiresIn as string) || 3600, // 1 hour default (industry standard)
              });
            } else {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body>
                    <h2>❌ Invalid Response</h2>
                    <p>Missing authentication data. Please try again.</p>
                    <p>You can close this window now.</p>
                  </body>
                </html>
              `);
              clearTimeout(timeout);
              this.cleanup();
              reject(new Error('Missing authentication data in callback'));
            }
          }
        } catch (error) {
          console.error('OAuth callback error:', error);
          clearTimeout(timeout);
          this.cleanup();
          reject(error);
        }
      });

      // Start local server
      this.server.listen(this.callbackPort, async () => {
        try {
          // Build OAuth URL
          const callbackUrl = `http://localhost:${this.callbackPort}/oauth/callback`;
          const authUrl = provider
            ? `${this.baseUrl}/oauth/signin?provider=${provider}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=token`
            : `${this.baseUrl}/oauth/signin?redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=token`;

          console.log('🌐 Opening browser for authentication...');
          console.log(`   If browser doesn't open, visit: ${authUrl}`);

          // Open browser
          await this.openBrowser(authUrl);
        } catch (error) {
          clearTimeout(timeout);
          this.cleanup();
          reject(error);
        }
      });

      this.server.on('error', (error) => {
        clearTimeout(timeout);
        this.cleanup();
        reject(error);
      });
    });
  }

  /**
   * Open browser to URL
   */
  private async openBrowser(url: string): Promise<void> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        await execAsync(`open "${url}"`);
      } else if (platform === 'win32') {
        await execAsync(`start "" "${url}"`);
      } else {
        // Linux
        await execAsync(`xdg-open "${url}"`);
      }
    } catch (error) {
      console.error('Failed to open browser automatically:', error);
      console.log(`\nPlease manually open this URL in your browser:\n${url}\n`);
    }
  }

  /**
   * Cleanup server
   */
  private cleanup(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }
}
