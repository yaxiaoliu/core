import { IRPCProtocol } from '@ali/ide-connection';
import { ExtHostAPIIdentifier, IMainThreadWorkspace, IExtHostStorage, ResourceTextEditDto, ResourceFileEditDto, IExtHostWorkspace } from '../../../common/vscode';
import { Injectable, Optinal, Autowired } from '@ali/common-di';
import { IWorkspaceService } from '@ali/ide-workspace';
import { FileStat } from '@ali/ide-file-service';
import { URI, ILogger, WithEventBus, OnEvent, CancellationToken } from '@ali/ide-core-browser';
import { IExtensionStorageService } from '@ali/ide-extension-storage';
import { IWorkspaceEditService, IWorkspaceEdit, IResourceTextEdit, IResourceFileEdit, WorkspaceEditDidRenameFileEvent } from '@ali/ide-workspace-edit';
import { WorkbenchEditorService } from '@ali/ide-editor';
import { FileSearchServicePath, IFileSearchService } from '@ali/ide-file-search/lib/common';
import type * as model from '../../../common/vscode/model.api';

@Injectable({multiple: true})
export class MainThreadWorkspace extends WithEventBus implements IMainThreadWorkspace {

  private readonly proxy: IExtHostWorkspace;
  private roots: FileStat[];

  @Autowired(IWorkspaceService)
  workspaceService: IWorkspaceService;

  @Autowired(WorkbenchEditorService)
  editorService: WorkbenchEditorService;

  @Autowired(FileSearchServicePath)
  private readonly fileSearchService;

  @Autowired(IExtensionStorageService)
  extensionStorageService: IExtensionStorageService;

  @Autowired(IWorkspaceEditService)
  workspaceEditService: IWorkspaceEditService;

  storageProxy: IExtHostStorage;

  @Autowired(ILogger)
  logger: ILogger;

  private workspaceChangeEvent;

  constructor(@Optinal(Symbol()) private rpcProtocol: IRPCProtocol) {
    super();
    this.proxy = this.rpcProtocol.getProxy(ExtHostAPIIdentifier.ExtHostWorkspace);

    this.processWorkspaceFoldersChanged(this.workspaceService.tryGetRoots());
    this.workspaceChangeEvent = this.workspaceService.onWorkspaceChanged((roots) => {
      this.processWorkspaceFoldersChanged(roots);
    });

    this.storageProxy = rpcProtocol.getProxy<IExtHostStorage>(ExtHostAPIIdentifier.ExtHostStorage);
  }

  async $startFileSearch(includePattern: string, options: { cwd?: string; absolute: boolean }, excludePatternOrDisregardExcludes: string | false | undefined, maxResult: number | undefined, token: CancellationToken): Promise<string[]> {
    const fileSearchOptions: IFileSearchService.Options = {
      rootUris: options.cwd ? [options.cwd] : (this.workspaceService.tryGetRoots().map((root) => root.uri)),
      excludePatterns: excludePatternOrDisregardExcludes ? [excludePatternOrDisregardExcludes] : undefined,
      limit: maxResult,
      includePatterns: [includePattern],
    };
    const result = await this.fileSearchService.find('', fileSearchOptions);

    return result;
  }

  private isAnyRootChanged(roots: FileStat[]): boolean {
    if (!this.roots || this.roots.length !== roots.length) {
        return true;
    }

    return this.roots.some((root, index) => root.uri !== roots[index].uri);
  }

  async processWorkspaceFoldersChanged(roots: FileStat[]): Promise<void> {
    if (this.isAnyRootChanged(roots) === false) {
        return;
    }
    this.roots = roots;
    this.proxy.$onWorkspaceFoldersChanged({ roots });

    // workspace变化，更新及初始化storage
    const storageWorkspacesData = await this.extensionStorageService.getAll(false);
    this.storageProxy.$updateWorkspaceStorageData(storageWorkspacesData);
  }

  dispose() {
    this.workspaceChangeEvent.dispose();
  }

  async $updateWorkspaceFolders(start: number, deleteCount?: number, workspaceToName?: {[key: string]: string}, ...rootsToAdd: string[]): Promise<void> {
    await this.workspaceService.spliceRoots(start, deleteCount, workspaceToName, ...rootsToAdd.map((root) => new URI(root)));
  }

  async $tryApplyWorkspaceEdit(dto: model.WorkspaceEditDto): Promise<boolean> {
    const workspaceEdit = reviveWorkspaceEditDto(dto);
    try {
      await this.workspaceEditService.apply(workspaceEdit);
      return true;
    } catch (e) {
      return false;
    }
  }

  async $saveAll(): Promise<boolean> {
    try {
      await this.editorService.saveAll();
      return true;
    } catch (e) {
      this.logger.error(e);
      return false;
    }
  }

  @OnEvent(WorkspaceEditDidRenameFileEvent)
  onRenameFile(e: WorkspaceEditDidRenameFileEvent) {
    this.proxy.$didRenameFile(e.payload.oldUri.codeUri, e.payload.newUri.codeUri);
  }

}

export function reviveWorkspaceEditDto(data: model.WorkspaceEditDto | undefined): IWorkspaceEdit {
  if (data && data.edits) {
    for (const edit of data.edits) {
      if (typeof (edit as ResourceTextEditDto).resource === 'object') {
        (edit as unknown as IResourceTextEdit).resource = URI.from(( edit as ResourceTextEditDto).resource);
        (edit as unknown as IResourceTextEdit).options = { openDirtyInEditor: true };
      } else {
        const resourceFileEdit = edit as unknown as IResourceFileEdit;
        resourceFileEdit.newUri = ( edit as ResourceFileEditDto).newUri ? URI.from(( edit as ResourceFileEditDto).newUri!) : undefined;
        resourceFileEdit.oldUri = ( edit as ResourceFileEditDto).oldUri ? URI.from(( edit as ResourceFileEditDto).oldUri!) : undefined;
        // 似乎 vscode 的行为默认不会 showInEditor，参考来自 codeMe 插件
        resourceFileEdit.options = {
          ...resourceFileEdit.options,
          showInEditor: false,
        };
      }
    }
  }
  return  data as unknown as IWorkspaceEdit;
}
