/**
 * Cross-platform HTTP utilities
 * Uses native Node.js https module for maximum compatibility
 */

import * as https from 'https';
import * as http from 'http';

export interface HttpResponse {
    statusCode: number;
    body: string;
    headers: http.IncomingHttpHeaders;
}

/**
 * Make an HTTP GET request using native Node.js modules
 * Works on all platforms without external dependencies
 * 
 * @param url The URL to fetch
 * @param options Optional request options
 * @returns Promise resolving to the response
 */
export function httpGet(url: string, options?: {
    headers?: Record<string, string>;
    timeout?: number;
}): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const requestOptions: https.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Pipeline-Core',
                'Accept': 'application/json',
                ...options?.headers
            },
            timeout: options?.timeout || 30000
        };

        const req = client.request(requestOptions, (res) => {
            let body = '';

            res.setEncoding('utf-8');
            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode || 0,
                    body,
                    headers: res.headers
                });
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.end();
    });
}

/**
 * Download a file from a URL and return its contents as a string
 * Follows redirects automatically
 * 
 * @param url The URL to download from
 * @param options Optional request options
 * @returns Promise resolving to the file contents
 */
export async function httpDownload(url: string, options?: {
    headers?: Record<string, string>;
    timeout?: number;
    maxRedirects?: number;
}): Promise<string> {
    const maxRedirects = options?.maxRedirects ?? 5;
    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount < maxRedirects) {
        const response = await httpGet(currentUrl, options);

        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            currentUrl = response.headers.location;
            redirectCount++;
            continue;
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
            return response.body;
        }

        throw new Error(`HTTP ${response.statusCode}: ${response.body.substring(0, 200)}`);
    }

    throw new Error(`Too many redirects (max: ${maxRedirects})`);
}

/**
 * Fetch JSON from a URL
 * 
 * @param url The URL to fetch
 * @param options Optional request options
 * @returns Promise resolving to the parsed JSON
 */
export async function httpGetJson<T = unknown>(url: string, options?: {
    headers?: Record<string, string>;
    timeout?: number;
}): Promise<T> {
    const response = await httpGet(url, {
        ...options,
        headers: {
            'Accept': 'application/json',
            ...options?.headers
        }
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
        return JSON.parse(response.body);
    }

    // Try to parse error message from JSON response
    try {
        const errorBody = JSON.parse(response.body);
        if (errorBody.message) {
            throw new Error(errorBody.message);
        }
    } catch {
        // Not JSON, use raw body
    }

    throw new Error(`HTTP ${response.statusCode}: ${response.body.substring(0, 200)}`);
}
