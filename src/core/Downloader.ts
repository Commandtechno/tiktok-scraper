/* eslint-disable consistent-return */
import request from 'request';
import { Agent } from 'http';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { forEachLimit } from 'async';

import { MultipleBar } from '../helpers';
import { DownloaderConstructor, PostCollector, ZipValues } from '../types';

export class Downloader {
    public progress: boolean;

    public mbars: MultipleBar;

    public progressBar: any[];

    public proxy: string;

    public agent: Agent | string;

    constructor({ progress, proxy }: DownloaderConstructor) {
        this.progress = true || progress;
        this.progressBar = [];
        this.mbars = new MultipleBar();
        this.agent = proxy && proxy.indexOf('socks') > -1 ? new SocksProxyAgent(proxy) : '';
        this.proxy = proxy && proxy.indexOf('socks') === -1 ? proxy : '';
    }

    /**
     * Add new bard to indicate download progress
     * @param {number} len
     */
    public addBar(len: number): any[] {
        this.progressBar.push(
            this.mbars.newBar('Downloading :id [:bar] :percent', {
                complete: '=',
                incomplete: ' ',
                width: 30,
                total: len,
            }),
        );

        return this.progressBar[this.progressBar.length - 1];
    }

    /**
     * Convert video file to a buffer
     * @param {*} item
     */
    public toBuffer(item: PostCollector): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            let r = request;
            let barIndex;
            let buffer = Buffer.from('');
            if (this.proxy) {
                r = request.defaults({ proxy: `http://${this.proxy}/` });
            }
            if (this.agent) {
                r = request.defaults({ agent: this.agent as Agent });
            }
            r.get(item.videoUrl)
                .on('response', response => {
                    if (this.progress) {
                        barIndex = this.addBar(parseInt(response.headers['content-length'] as string, 10));
                    }
                })
                .on('data', chunk => {
                    buffer = Buffer.concat([buffer, chunk as Buffer]);
                    if (this.progress) {
                        barIndex.tick(chunk.length, { id: item.id });
                    }
                })
                .on('end', () => {
                    resolve(buffer);
                })
                .on('error', () => {
                    reject(new Error('Cant download media. If you were using proxy, please try without it.'));
                });
        });
    }

    /**
     * Download and ZIP video files
     */
    public zipIt({ collector, filepath, fileName, asyncDownload }: ZipValues) {
        return new Promise((resolve, reject) => {
            const zip = filepath ? `${filepath}/${fileName}.zip` : `${fileName}.zip`;
            const output = createWriteStream(zip);
            const archive = archiver('zip', {
                gzip: true,
                zlib: { level: 9 },
            });
            archive.pipe(output);

            forEachLimit(
                collector,
                asyncDownload,
                (item: PostCollector, cb) => {
                    this.toBuffer(item)
                        .then(buffer => {
                            archive.append(buffer, { name: `${item.id}.mp4` });
                            cb(null);
                        })
                        .catch(error => {
                            cb(error);
                        });
                },
                error => {
                    if (error) {
                        return reject(error);
                    }

                    archive.finalize();
                    archive.on('end', () => resolve());
                },
            );
        });
    }
}