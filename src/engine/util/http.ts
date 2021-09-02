import fs from "fs";
import axios, {AxiosRequestConfig} from "axios";
import {mkParents} from "../core/paths";
import * as mime from 'mime-types';
import {DownloadProgress} from "../core/state";
import {GracefulStopError} from "../downloading/downloader-wrappers/download-wrapper";


export async function downloadBinary (url: string, filePath: string): Promise<string> {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 10000
    });

    await mkParents(filePath);

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('close', resolve)
        writer.on('error', reject)
    })
}

/**
 * Gather basic mime information about the given URL.
 * @param url
 */
export async function getMimeType(url: string) {
    return axios({
        url,
        method: 'HEAD',
        timeout: 10000
    }).then( res => {
        return {
            url: res.request.res.responseUrl,
            ext: getMediaMimeExtension(res.headers['content-type']) || null
        }
    });
}


/**
 * Validates that the given URL is acceptable media, then downloads it.
 * Appends the extension to the file path based off the URL's mimetype.
 * Also manages updating the given progress object, and respects stop commands.
 * @param url
 * @param filePath
 * @param prog
 * @returns The extension of the downloaded file, without the dot.
 */
export async function downloadMedia(url: string, filePath: string, prog: DownloadProgress): Promise<string> {
    const CancelToken = axios.CancelToken;
    let cancel: any;

    const { data, headers } = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        cancelToken: new CancelToken(function executor(c) {
            // An executor function receives a cancel function as a parameter
            cancel = c;
        })
    });

    const ext = getMediaMimeExtension(headers['content-type'])
    if (!ext) throw Error('Attempted to download non-media mimetype.');

    await mkParents(filePath);

    const totalLength = headers['content-length']
    const writer = fs.createWriteStream(filePath + '.' + ext);
    let downloaded = 0;

    data.on('data', (chunk: any) => {
        if (prog.shouldStop) {
            console.debug('cancel direct dl', url);
            writer.close();
            return cancel();
        }
        if (totalLength) {
            downloaded += chunk.length;
            prog.knowsPercent = true;
            prog.percent = parseFloat((downloaded/totalLength).toFixed(2));
        } else {
            prog.knowsPercent = false;
        }
    })
    data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('close', () => {
            if (prog.shouldStop) return reject(new GracefulStopError('Interrupted http download.'))
            resolve(ext as string)
        })
        writer.on('error', err => reject(err))
    })
}

export async function getJSON (url: string|URL, params: Record<string, string> = {}, ext: Partial<AxiosRequestConfig> = {}) {
    if (url instanceof URL) url = url.toString();

    const response = await axios({
        url,
        method: 'GET',
        timeout: 10000,
        params,
        ...ext
    });

    return response.data;
}

export const getRaw = getJSON;

const allowedTypes = ['image/', 'audio/', 'video/'];

/**
 * Returns the extension (without a dot) to use for the given mimetype string.
 * Returns false if an unknown or non-media type is provided.
 * @param type
 */
export function getMediaMimeExtension(type: string) {
    if (!type || !allowedTypes.some(t => type.trim().toLowerCase().startsWith(t))) return false;
    const ext = mime.extension(type);
    return ext === 'jpeg' ? 'jpg' : ext;
}
