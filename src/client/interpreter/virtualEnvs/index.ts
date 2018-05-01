// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';
import { IProcessService } from '../../common/process/types';
import { IServiceContainer } from '../../ioc/types';
import { InterpreterType, IPipEnvService } from '../contracts';
import { IVirtualEnvironmentManager } from './types';

const PYENVFILES = ['pyvenv.cfg', path.join('..', 'pyvenv.cfg')];

@injectable()
export class VirtualEnvironmentManager implements IVirtualEnvironmentManager {
    private processService: IProcessService;
    private pipEnvService: IPipEnvService;
    private fs: IFileSystem;
    private pyEnvRoot?: string;
    private workspaceService?: IWorkspaceService;
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        this.processService = serviceContainer.get<IProcessService>(IProcessService);
        this.fs = serviceContainer.get<IFileSystem>(IFileSystem);
        this.pipEnvService = serviceContainer.get<IPipEnvService>(IPipEnvService);
        this.workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    }
    public async getEnvironmentName(pythonPath: string): Promise<string> {
        // https://stackoverflow.com/questions/1871549/determine-if-python-is-running-inside-virtualenv
        // hasattr(sys, 'real_prefix') works for virtualenv while
        // '(hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix))' works for venv
        try {
            const code = 'import sys\nif hasattr(sys, "real_prefix"):\n  print("virtualenv")\nelif hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix:\n  print("venv")';
            const output = await this.processService.exec(pythonPath, ['-c', code]);
            if (output.stdout.length > 0) {
                return output.stdout.trim();
            }
        } catch {
            // do nothing.
        }
        return '';
    }
    public async getEnvironmentType(pythonPath: string, resource?: Uri): Promise<InterpreterType> {
        const dir = path.dirname(pythonPath);
        const pyEnvCfgFiles = PYENVFILES.map(file => path.join(dir, file));
        for (const file of pyEnvCfgFiles) {
            if (await this.fs.fileExistsAsync(file)) {
                return InterpreterType.Venv;
            }
        }

        const pyEnvRoot = await this.getPyEnvRoot();
        if (pythonPath.startsWith(pyEnvRoot)) {
            return InterpreterType.Pyenv;
        }

        const defaultWorkspaceUri = this.workspaceService.hasWorkspaceFolders ? this.workspaceService.workspaceFolders![0].uri : undefined;
        const workspaceFolder = resource ? this.workspaceService.getWorkspaceFolder(resource) : undefined;
        const workspaceUri = workspaceFolder ? workspaceFolder.uri : defaultWorkspaceUri;
        if (workspaceUri && this.pipEnvService.isRelatedPipEnvironment(pythonPath, workspaceUri.fsPath)) {
            return InterpreterType.PipEnv;
        }

        if ((await this.getEnvironmentName(pythonPath)).length > 0) {
            return InterpreterType.VirtualEnv;
        }

        // Lets not try to determine whether this is a conda environment or not.
        return InterpreterType.Unknown;
    }
    private async getPyEnvRoot(): Promise<string | undefined> {
        if (this.pyEnvRoot) {
            return this.pyEnvRoot;
        }
        try {
            const output = await this.processService.exec('pyenv', ['root']);
            return this.pyEnvRoot = output.stdout.trim();
        } catch {
            return;
        }
    }
}
