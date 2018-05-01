// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import * as path from 'path';
import { Uri } from 'vscode';
import { IServiceContainer } from '../../ioc/types';
import { EXTENSION_ROOT_DIR } from '../constants';
import { ErrorUtils } from '../errors/errorUtils';
import { ModuleNotInstalledError } from '../errors/moduleNotInstalledError';
import { Architecture, IFileSystem } from '../platform/types';
import { IConfigurationService } from '../types';
import { EnvironmentVariables } from '../variables/types';
import { ExecutionResult, InterpreterInfomation, IProcessService, IPythonExecutionService, ObservableExecutionResult, PythonVersionInfo, SpawnOptions } from './types';

export type Options = {
    env?: EnvironmentVariables | undefined;
    resource?: Uri;
    pythonPath?: string;
};

@injectable()
export class PythonExecutionService implements IPythonExecutionService {
    private readonly procService: IProcessService;
    private readonly configService: IConfigurationService;
    private readonly fileSystem: IFileSystem;
    private readonly envVars?: EnvironmentVariables;
    private readonly resource?: Uri;
    private readonly _pythonPath?: string;

    constructor(serviceContainer: IServiceContainer, options: Options) {
        this.envVars = options.env;
        this.resource = options.resource;
        this._pythonPath = options.pythonPath;
        this.procService = serviceContainer.get<IProcessService>(IProcessService);
        this.configService = serviceContainer.get<IConfigurationService>(IConfigurationService);
        this.fileSystem = serviceContainer.get<IFileSystem>(IFileSystem);
    }

    public async getInterpreterInformation(): Promise<InterpreterInfomation | undefined> {
        const pythonPath = this.pythonPath;
        const file = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'interpreterInfo.py');
        try {
            const [version, jsonValue] = await Promise.all([
                this.procService.exec(pythonPath, ['--version'], { mergeStdOutErr: true })
                    .then(output => output.stdout.trim()),
                this.procService.exec(pythonPath, [file], { mergeStdOutErr: true })
                    .then(output => output.stdout.trim())
            ]);

            const json = JSON.parse(jsonValue) as { versionInfo: PythonVersionInfo; sysPrefix: string; sysVersion: string; is64Bit: boolean };
            return {
                architecture: json.is64Bit ? Architecture.x64 : Architecture.x86,
                path: pythonPath,
                version,
                sysVersion: json.sysVersion,
                version_info: json.versionInfo,
                sysPrefix: json.sysPrefix
            };
        } catch (ex) {
            console.error(`Failed to get interpreter information for '${pythonPath}'`, ex);
        }
    }
    public async getExecutablePath(): Promise<string> {
        // If we've passed the python file, then return the file.
        // This is because on mac if using the interpreter /usr/bin/python2.7 we can get a different value for the path
        if (await this.fileSystem.fileExistsAsync(this.pythonPath)) {
            return this.pythonPath;
        }
        return this.procService.exec(this.pythonPath, ['-c', 'import sys;print(sys.executable)'], { env: this.envVars, throwOnStdErr: true })
            .then(output => output.stdout.trim());
    }
    public async isModuleInstalled(moduleName: string): Promise<boolean> {
        return this.procService.exec(this.pythonPath, ['-c', `import ${moduleName}`], { env: this.envVars, throwOnStdErr: true })
            .then(() => true).catch(() => false);
    }

    public execObservable(args: string[], options: SpawnOptions): ObservableExecutionResult<string> {
        const opts: SpawnOptions = { ...options };
        if (this.envVars) {
            opts.env = this.envVars;
        }
        return this.procService.execObservable(this.pythonPath, args, opts);
    }
    public execModuleObservable(moduleName: string, args: string[], options: SpawnOptions): ObservableExecutionResult<string> {
        const opts: SpawnOptions = { ...options };
        if (this.envVars) {
            opts.env = this.envVars;
        }
        return this.procService.execObservable(this.pythonPath, ['-m', moduleName, ...args], opts);
    }
    public async exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>> {
        const opts: SpawnOptions = { ...options };
        if (this.envVars) {
            opts.env = this.envVars;
        }
        return this.procService.exec(this.pythonPath, args, opts);
    }
    public async execModule(moduleName: string, args: string[], options: SpawnOptions): Promise<ExecutionResult<string>> {
        const opts: SpawnOptions = { ...options };
        if (this.envVars) {
            opts.env = this.envVars;
        }
        const result = await this.procService.exec(this.pythonPath, ['-m', moduleName, ...args], opts);

        // If a module is not installed we'll have something in stderr.
        if (moduleName && ErrorUtils.outputHasModuleNotInstalledError(moduleName!, result.stderr)) {
            const isInstalled = await this.isModuleInstalled(moduleName!);
            if (!isInstalled) {
                throw new ModuleNotInstalledError(moduleName!);
            }
        }

        return result;
    }
    private get pythonPath(): string {
        if (this._pythonPath) {
            return this._pythonPath;
        }
        return this.configService.getSettings(this.resource).pythonPath;
    }
}
