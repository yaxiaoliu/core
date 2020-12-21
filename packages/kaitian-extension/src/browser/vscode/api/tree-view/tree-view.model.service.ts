import { Injectable, Autowired, INJECTOR_TOKEN, Injector } from '@ali/common-di';
import { DecorationsManager, Decoration, IRecycleTreeHandle, TreeNodeType, PromptValidateMessage, TreeNodeEvent, WatchEvent, TreeNode } from '@ali/ide-components';
import { DisposableCollection, Emitter, PreferenceService, IContextKeyService, CommandRegistry, Deferred, ThrottledDelayer, CommandService } from '@ali/ide-core-browser';
import { ExtensionCompositeTreeNode, ExtensionTreeNode, ExtensionTreeRoot } from './tree-view.node.defined';
import * as styles from './tree-view-node.module.less';
import { ExtensionTreeModel } from './tree-view.model';
import { TreeViewBaseOptions, TreeViewItem } from '../../../../common/vscode';
import { TreeViewDataProvider } from '../main.thread.treeview';
import { AbstractMenuService, ICtxMenuRenderer, generateCtxMenu, MenuId } from '@ali/ide-core-browser/lib/menu/next';
import { getTreeViewCollapseAllCommand } from './util';

export const IExtensionTreeViewModel = Symbol('IExtensionTreeViewModel');

export const ITreeViewId = Symbol('ITreeViewId');
export const ITreeViewBaseOptions = Symbol('TreeViewBaseOptions');

export interface IExtensionTreeHandle extends IRecycleTreeHandle {
  hasDirectFocus: () => boolean;
}

export interface ExtensionTreeValidateMessage extends PromptValidateMessage {
  value: string;
}

const ITreeViewDataProvider  = Symbol('ITreeViewDataProvider');

@Injectable()
export class ExtensionTreeViewModel {

  static DEFAULT_REVEAL_DELAY = 500;
  static DEFAULT_REFRESH_DELAY = 500;

  static createContainer(injector: Injector, tree: TreeViewDataProvider, treeViewId: string, options: TreeViewBaseOptions): Injector {
    const child = injector.createChild([
      {
        token: ITreeViewDataProvider,
        useValue: tree,
      },
      {
        token: IExtensionTreeViewModel,
        useClass: ExtensionTreeViewModel,
      },
      {
        token: ITreeViewId,
        useValue: treeViewId,
      },
      {
        token: ITreeViewBaseOptions,
        useValue: options,
      },
    ]);
    return child;
  }

  static createModel(injector: Injector, tree: TreeViewDataProvider, treeViewId: string, options: TreeViewBaseOptions): ExtensionTreeViewModel {
    return ExtensionTreeViewModel.createContainer(injector, tree, treeViewId, options).get(IExtensionTreeViewModel);
  }

  @Autowired(INJECTOR_TOKEN)
  private readonly injector: Injector;

  @Autowired(ITreeViewDataProvider)
  private readonly treeViewDataProvider: TreeViewDataProvider;

  @Autowired(PreferenceService)
  private readonly preferenceService: PreferenceService;

  @Autowired(ITreeViewId)
  public readonly treeViewId: string;

  @Autowired(ITreeViewBaseOptions)
  public readonly treeViewOptions: TreeViewBaseOptions;

  @Autowired(AbstractMenuService)
  private readonly menuService: AbstractMenuService;

  @Autowired(IContextKeyService)
  private readonly contextKeyService: IContextKeyService;

  @Autowired(CommandRegistry)
  private readonly commandRegistry: CommandRegistry;

  @Autowired(CommandService)
  private readonly commandService: CommandService;

  private _treeModel: ExtensionTreeModel;

  private _whenReady: Promise<void>;

  private _decorations: DecorationsManager;
  private _extensionTreeHandle: IExtensionTreeHandle;

  // 装饰器
  private selectedDecoration: Decoration = new Decoration(styles.mod_selected); // 选中态
  private focusedDecoration: Decoration = new Decoration(styles.mod_focused); // 焦点态
  private loadingDecoration: Decoration = new Decoration(styles.mod_loading); // 焦点态
  private cutDecoration: Decoration = new Decoration(styles.mod_cut); // 焦点态
  // 即使选中态也是焦点态的节点，全局仅会有一个
  private _focusedNode: ExtensionTreeNode | ExtensionCompositeTreeNode | undefined;
  // 选中态的节点，会可能有多个
  private _selectedNodes: (ExtensionTreeNode | ExtensionCompositeTreeNode)[] = [];
  private clickTimes: number;
  private clickTimer: any;

  private preContextMenuFocusedNode: ExtensionTreeNode | ExtensionCompositeTreeNode | null;

  private disposableCollection: DisposableCollection = new DisposableCollection();

  private onDidFocusedNodeChangeEmitter: Emitter<string | void> = new Emitter();
  private onDidSelectedNodeChangeEmitter: Emitter<string[]> = new Emitter();
  private onDidChangeExpansionStateEmitter: Emitter<{
    treeItemId: string,
    expanded: boolean,
  }> = new Emitter();

  private _isMutiSelected: boolean = false;
  private refreshDelayer = new ThrottledDelayer<void>(ExtensionTreeViewModel.DEFAULT_REFRESH_DELAY);
  private revealDelayer = new ThrottledDelayer<void>(ExtensionTreeViewModel.DEFAULT_REVEAL_DELAY);
  private revealDeferred: Deferred<void> | null;
  private refreshDeferred: Deferred<void> | null;

  constructor() {
    this._whenReady = this.initTreeModel();
    this.registerCollapseAllCommand();
  }

  get onDidFocusedNodeChange() {
    return this.onDidFocusedNodeChangeEmitter.event;
  }

  get onDidChangeExpansionState() {
    return this.onDidChangeExpansionStateEmitter.event;
  }

  get onDidSelectedNodeChange() {
    return this.onDidSelectedNodeChangeEmitter.event;
  }

  get extensionTreeHandle() {
    return this._extensionTreeHandle;
  }

  get decorations() {
    return this._decorations;
  }

  get treeModel() {
    return this._treeModel;
  }

  get whenReady() {
    return this._whenReady;
  }

  // 既是选中态，也是焦点态节点
  get focusedNode() {
    return this._focusedNode;
  }
  // 是选中态，非焦点态节点
  get selectedNodes() {
    return this._selectedNodes;
  }

  async initTreeModel() {
    // 根据是否为多工作区创建不同根节点
    const root = (await this.treeViewDataProvider.resolveChildren())[0];
    this._treeModel = this.injector.get<any>(ExtensionTreeModel, [root]);

    this.initDecorations(root);
    this.disposableCollection.push(this.treeViewDataProvider);
    this.disposableCollection.push(this.treeModel.root.watcher.on(TreeNodeEvent.WillResolveChildren, (target) => {
      this.loadingDecoration.addTarget(target);
    }));
    this.disposableCollection.push(this.treeModel.root.watcher.on(TreeNodeEvent.DidResolveChildren, (target) => {
      this.loadingDecoration.removeTarget(target);
    }));
    this.disposableCollection.push(this.treeModel.root.watcher.on(TreeNodeEvent.DidChangeExpansionState, (target: ExtensionTreeNode, nowExpanded) => {
      this.onDidChangeExpansionStateEmitter.fire({
        treeItemId: target.treeItemId,
        expanded: nowExpanded,
      });
    }));
    this.disposableCollection.push(this.treeViewDataProvider.onTreeDataChanged((itemsToRefresh?: TreeViewItem) => {
      this.refresh(itemsToRefresh);
    }));
    this.disposableCollection.push(this.treeViewDataProvider.onRevealChanged((treeItemId: string) => {
      this.reveal(treeItemId);
    }));
    this.disposableCollection.push(this.treeViewDataProvider.onRevealChanged((treeItemId: string) => {
      this.reveal(treeItemId);
    }));
    this.disposableCollection.push(this.treeModel!.onWillUpdate(() => {
      // 更新树前更新下选中节点
      if (this.selectedNodes.length !== 0) {
        // 仅处理一下单选情况
        const node = this.treeModel?.root.getTreeNodeByPath(this.selectedNodes[0].path);
        this.selectedDecoration.addTarget(node as ExtensionTreeNode);
      }
    }));
  }

  async updateTreeModel() {
    const root = await this.treeViewDataProvider.resolveChildren()[0];
    this._treeModel = this.injector.get<any>(ExtensionTreeModel, [root]);
  }

  initDecorations(root) {
    this._decorations = new DecorationsManager(root as any);
    this._decorations.addDecoration(this.selectedDecoration);
    this._decorations.addDecoration(this.focusedDecoration);
    this._decorations.addDecoration(this.cutDecoration);
    this._decorations.addDecoration(this.loadingDecoration);
  }

  // 清空所有节点选中态
  clearNodeSelectedDecoration = () => {
    this._selectedNodes.forEach((node) => {
      this.selectedDecoration.removeTarget(node);
    });
    this._selectedNodes = [];
    this.onDidSelectedNodeChangeEmitter.fire([]);
  }

  // 清空其他选中/焦点态节点，更新当前焦点节点
  activeNodeDecoration = (target: ExtensionTreeNode | ExtensionCompositeTreeNode) => {
    if (target === this.treeModel.root as TreeNode) {
      // 根节点不能选中
      return;
    }

    if (this.preContextMenuFocusedNode) {
      this.focusedDecoration.removeTarget(this.preContextMenuFocusedNode);
      this.selectedDecoration.removeTarget(this.preContextMenuFocusedNode);
      this.preContextMenuFocusedNode = null;
    }
    if (target) {
      if (this.selectedNodes.length > 0) {
        this.selectedNodes.forEach((node) => {
          this.selectedDecoration.removeTarget(node);
        });
      }
      if (this.focusedNode) {
        this.focusedDecoration.removeTarget(this.focusedNode);
      }
      this.selectedDecoration.addTarget(target);
      this.focusedDecoration.addTarget(target);
      this._focusedNode = target;
      this._selectedNodes = [target];
      // 选中及焦点文件变化
      this.onDidFocusedNodeChangeEmitter.fire(target.treeItemId);
      this.onDidSelectedNodeChangeEmitter.fire([target.treeItemId]);
      // 通知视图更新
      this.treeModel.dispatchChange();
    }
  }

  // 清空其他焦点态节点，更新当前焦点节点，
  // removePreFocusedDecoration 表示更新焦点节点时如果此前已存在焦点节点，之前的节点装饰器将会被移除
  activeNodeFocusedDecoration = (target: ExtensionTreeNode | ExtensionCompositeTreeNode, removePreFocusedDecoration: boolean = false) => {
    if (target === this.treeModel.root) {
      // 根节点不能选中
      return;
    }

    if (this.focusedNode !== target) {
      if (removePreFocusedDecoration) {
        // 当存在上一次右键菜单激活的文件时，需要把焦点态的文件节点的装饰器全部移除
        if (this.preContextMenuFocusedNode) {
          this.focusedDecoration.removeTarget(this.preContextMenuFocusedNode);
          this.selectedDecoration.removeTarget(this.preContextMenuFocusedNode);
        } else if (!!this.focusedNode) {
          // 多选情况下第一次切换焦点文件
          this.focusedDecoration.removeTarget(this.focusedNode);
        }
        this.preContextMenuFocusedNode = target;
      } else if (!!this.focusedNode) {
        this.preContextMenuFocusedNode = null;
        this.focusedDecoration.removeTarget(this.focusedNode);
      }
      if (target) {
        this.selectedDecoration.addTarget(target);
        this.focusedDecoration.addTarget(target);
        this._focusedNode = target;
        this._selectedNodes.push(target);
        // 事件通知状态变化
        this.onDidFocusedNodeChangeEmitter.fire(target.treeItemId);
        this.onDidSelectedNodeChangeEmitter.fire(this._selectedNodes.map((node) => node.treeItemId));
      }
    }
    // 通知视图更新
    this.treeModel.dispatchChange();
  }

  // 清空其他选中/焦点态节点，更新当前选中节点
  selectNodeDecoration = (target: ExtensionTreeNode | ExtensionCompositeTreeNode, dispatchChange: boolean = true) => {
    if (target === this.treeModel.root) {
      // 根节点不能选中
      return;
    }

    if (this.preContextMenuFocusedNode) {
      this.focusedDecoration.removeTarget(this.preContextMenuFocusedNode);
      this.selectedDecoration.removeTarget(this.preContextMenuFocusedNode);
      this.preContextMenuFocusedNode = null;
    }
    if (target) {
      if (this.selectedNodes.length > 0) {
        this.selectedNodes.forEach((file) => {
          this.selectedDecoration.removeTarget(file);
        });
      }
      if (this.focusedNode) {
        this.focusedDecoration.removeTarget(this.focusedNode);
      }
      this.selectedDecoration.addTarget(target);
      this._selectedNodes = [target];
      // 选中及焦点文件变化
      this.onDidSelectedNodeChangeEmitter.fire([target.treeItemId]);
      // 通知视图更新
      if (dispatchChange) {
        this.treeModel.dispatchChange();
      }
    }
  }

  // 选中当前指定节点，添加装饰器属性
  activeNodeSelectedDecoration = (target: ExtensionTreeNode | ExtensionCompositeTreeNode) => {
    if (this._selectedNodes.indexOf(target) > -1) {
      return;
    }
    this._selectedNodes.push(target);
    this.selectedDecoration.addTarget(target);
    // 选中状态变化
    this.onDidSelectedNodeChangeEmitter.fire(this._selectedNodes.map((node) => node.treeItemId));
    // 通知视图更新
    this.treeModel.dispatchChange();
  }

  // 选中范围内的所有节点
  activeNodeDecorationByRange = (begin: number, end: number) => {
    this.clearNodeSelectedDecoration();
    this.preContextMenuFocusedNode = null;
    for (; begin <= end; begin++) {
      const node = this.treeModel.root.getTreeNodeAtIndex(begin);
      if (node) {
        this._selectedNodes.push(node as ExtensionTreeNode);
        this.selectedDecoration.addTarget(node);
      }
    }
    // 选中状态变化
    this.onDidSelectedNodeChangeEmitter.fire(this._selectedNodes.map((node) => node.treeItemId));
    // 通知视图更新
    this.treeModel.dispatchChange();
  }

  // 取消选中节点焦点
  enactiveNodeDecoration = () => {
    if (this.focusedNode) {
      this.focusedDecoration.removeTarget(this.focusedNode);
      this.onDidFocusedNodeChangeEmitter.fire();
      this.treeModel.dispatchChange();
    }
    this._focusedNode = undefined;
  }

  toggleDirectory = async (item: ExtensionCompositeTreeNode) => {
    if (item.expanded) {
      this.extensionTreeHandle.collapseNode(item);
    } else {
      this.extensionTreeHandle.expandNode(item);
    }
  }

  removeNodeDecoration() {
    if (!this.decorations) {
      return;
    }
    this.decorations.removeDecoration(this.selectedDecoration);
    this.decorations.removeDecoration(this.focusedDecoration);
  }

  handleTreeHandler(handle: IExtensionTreeHandle) {
    this._extensionTreeHandle = handle;
  }

  handleTreeBlur = () => {
    // 清空焦点状态
    this.enactiveNodeDecoration();
  }

  handleTreeFocus = () => {
    // 激活面板
  }

  handleItemRangeClick = (item: ExtensionTreeNode | ExtensionCompositeTreeNode, type: TreeNodeType) => {
    if (!this.focusedNode) {
      this.handleItemClick(item, type);
    } else if (this.focusedNode && this.focusedNode !== item) {
      this._isMutiSelected = true;
      const targetIndex = this.treeModel.root.getIndexAtTreeNode(item);
      const preFocusedNodeIndex = this.treeModel.root.getIndexAtTreeNode(this.focusedNode);
      if (preFocusedNodeIndex > targetIndex) {
        this.activeNodeDecorationByRange(targetIndex, preFocusedNodeIndex);
      } else if (preFocusedNodeIndex < targetIndex) {
        this.activeNodeDecorationByRange(preFocusedNodeIndex, targetIndex);
      }
    }
  }

  handleItemToggleClick = (item: ExtensionTreeNode | ExtensionCompositeTreeNode, type: TreeNodeType) => {
    this._isMutiSelected = true;
    if (type !== TreeNodeType.CompositeTreeNode && type !== TreeNodeType.TreeNode) {
      return;
    }
    // 选中的节点不是选中状态时，默认先更新节点为选中状态
    // 后续点击切换焦点状态
    if (this.selectedNodes.indexOf(item) > -1) {
      if (this.focusedNode === item) {
        this.enactiveNodeDecoration();
      } else {
        this.activeNodeFocusedDecoration(item);
      }
    } else {
      this.activeNodeSelectedDecoration(item);
    }
  }

  handleItemClick = (item: ExtensionTreeNode | ExtensionCompositeTreeNode, type: TreeNodeType) => {
    this._isMutiSelected = false;
    // 单选操作默认先更新选中状态
    if (type === TreeNodeType.CompositeTreeNode || type === TreeNodeType.TreeNode) {
      this.activeNodeDecoration(item);
    }
    if (item.command) {
      this.commandService.executeCommand(item.command.id, ...(item.command.arguments || []));
    } else {
      this.clickTimes++;
      if (type === TreeNodeType.CompositeTreeNode) {
        if (this.preferenceService.get('workbench.list.openMode') === 'singleClick') {
          this.toggleDirectory(item as ExtensionCompositeTreeNode);
        }
      }
      if (this.clickTimer) {
        clearTimeout(this.clickTimer);
      }
      this.clickTimer = setTimeout(() => {
        // 单击事件
        // 200ms内多次点击默认为双击事件
        if (this.clickTimes > 1) {
          if (type !== TreeNodeType.TreeNode) {
            if (this.preferenceService.get('workbench.list.openMode') === 'doubleClick') {
              this.toggleDirectory(item as ExtensionCompositeTreeNode);
            }
          }
        }
        this.clickTimes = 0;
      }, 200);
    }
  }

  handleContextMenu = (ev: React.MouseEvent, item?: ExtensionCompositeTreeNode | ExtensionTreeNode) => {
    ev.stopPropagation();
    ev.preventDefault();

    const { x, y } = ev.nativeEvent;

    if (item) {
      this.activeNodeFocusedDecoration(item, true);
    } else {
      this.enactiveNodeDecoration();
    }
    let nodes: (ExtensionTreeNode | ExtensionCompositeTreeNode)[];
    let node: ExtensionTreeNode | ExtensionCompositeTreeNode;

    if (!item) {
      // 空白区域右键菜单
      nodes = [this.treeModel.root as ExtensionCompositeTreeNode];
      node = this.treeModel.root as ExtensionCompositeTreeNode;
    } else {
      node = item;
      nodes = this._isMutiSelected ? this.selectedNodes : [node];
    }

    const menuNodes = this.getCtxMenuNodes(node.contextValue);
    const ctxMenuRenderer: ICtxMenuRenderer = this.injector.get(ICtxMenuRenderer);

    ctxMenuRenderer.show({
      anchor: { x, y },
      menuNodes,
      args: [{treeViewId: this.treeViewId, treeItemId: node.treeItemId}, nodes.map((node) => ({treeViewId: this.treeViewId, treeItemId: node.treeItemId}))],
    });
  }

  private getCtxMenuNodes(viewItemValue: string) {
    return this.getMenuNodes(viewItemValue)[1];
  }

  private getMenuNodes(viewItemValue: string) {
    const viewContextKey = this.contextKeyService.createScoped();

    viewContextKey.createKey('view', this.treeViewId);
    viewContextKey.createKey('viewItem', viewItemValue);

    // viewItem
    const menus = this.menuService.createMenu(MenuId.ViewItemContext, viewContextKey);
    const result = generateCtxMenu({ menus, separator: 'inline'  });
    menus.dispose();
    viewContextKey.dispose();

    return result;
  }

  public getInlineMenuNodes(viewItemValue: string) {
    return this.getMenuNodes(viewItemValue)[0];
  }

  registerCollapseAllCommand() {
    if (this.treeViewOptions?.showCollapseAll) {
      // 注册真实的 command handler
      const treeViewCollapseAllCommand = getTreeViewCollapseAllCommand(this.treeViewId);
      this.disposableCollection.push(
        this.commandRegistry.registerCommand(treeViewCollapseAllCommand, {
          execute: () => {
            this.collapseAll();
          },
        }),
      );
    }
  }

  collapseAll() {
    this.treeModel.root.collapsedAll();
  }

  async refresh(item?: TreeViewItem) {
    await this.whenReady;
    if (!this.refreshDelayer.isTriggered()) {
      this.refreshDelayer.cancel();
    } else {
      if (this.refreshDeferred) {
        await this.refreshDeferred.promise;
      }
    }
    return this.refreshDelayer.trigger(async () => {
      this.refreshDeferred = new Deferred();
      if (!item) {
        this.treeModel.root.forceReloadChildrenQuiet();
      } else {
        const id = this.treeViewDataProvider.getTreeNodeIdByTreeItemId(item.id);
        if (!id) {
          return;
        }
        const cache = (this.treeModel.root as ExtensionTreeRoot).getTreeNodeById(id);
        if (!cache) {
          return ;
        }
        let path;
        if (ExtensionCompositeTreeNode.is(cache)) {
          path = (cache as ExtensionCompositeTreeNode).path;
        } else if (!!cache.parent) {
          path = (cache.parent as ExtensionCompositeTreeNode).path;
        }
        const watcher = this.treeModel.root?.watchEvents.get(path);
        if (watcher && typeof watcher.callback === 'function') {
          await watcher.callback({ type: WatchEvent.Changed, path });
        }
      }
      this.refreshDeferred.resolve();
      this.refreshDeferred = null;
    });
  }

  async reveal(treeItemId: string) {
    await this.whenReady;
    if (!this.revealDelayer.isTriggered()) {
      this.revealDelayer.cancel();
    } else if (this.revealDeferred) {
      await this.revealDeferred.promise;
    }
    return this.revealDelayer.trigger(async () => {
      this.revealDeferred = new Deferred();
      const id = this.treeViewDataProvider.getTreeNodeIdByTreeItemId(treeItemId);
      if (!id) {
        return;
      }
      const cache = (this.treeModel.root as ExtensionTreeRoot).getTreeNodeById(id);
      if (!cache) {
        return ;
      }

      const node = await this.extensionTreeHandle.ensureVisible(cache.path) as ExtensionTreeNode;

      if (node) {
        this.selectNodeDecoration(node);
      }
      this.revealDeferred.resolve();
      this.revealDeferred = null;
    });
  }
}
