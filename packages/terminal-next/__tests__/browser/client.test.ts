/**
 * Terminal Client Test
 */
import * as WebSocket from 'ws';
import * as httpProxy from 'http-proxy';
import { Disposable, FileUri, URI } from '@ali/ide-core-common';
import { createProxyServer, createWsServer, resetPort } from './proxy';
import {
  defaultName,
} from './mock.service';
import { ITerminalClientFactory, ITerminalGroupViewService, ITerminalClient, IWidget } from '../../src/common';
import { delay } from './utils';
import { injector } from './inject';
import { IWorkspaceService } from '@ali/ide-workspace';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';

function createDOMContainer() {
  const div = document.createElement('div');
  div.style.width = '400px';
  div.style.height = '400px';
  document.body.appendChild(div);
  return div;
}

describe('Terminal Client', () => {
  let client: ITerminalClient;
  let widget: IWidget;
  let proxy: httpProxy;
  let server: WebSocket.Server;
  let view: ITerminalGroupViewService;
  let factory: ITerminalClientFactory;
  let workspaceService: IWorkspaceService;
  let root: URI | null;

  beforeAll(async () => {
    root = FileUri.create(path.join(os.tmpdir(), 'preference-service-test'));

    await fs.ensureDir(root.path.toString());

    workspaceService = injector.get(IWorkspaceService);

    await workspaceService.setWorkspace({
      uri: root.toString(),
      lastModification: new Date().getTime(),
      isDirectory: true,
    });
    resetPort();
    factory = injector.get(ITerminalClientFactory);
    view = injector.get(ITerminalGroupViewService);
    server = createWsServer();
    proxy = createProxyServer();
    const index = view.createGroup();
    const group = view.getGroup(index);
    widget = view.createWidget(group);
    // clientHeight === 0 时会跳过视图渲染，这里强行修改一下 clientHeight 用于测试
    widget.element = new Proxy(createDOMContainer(), {
      get(target, prop, _receiver) {
        if (prop === 'clientHeight') {
          return 400;
        }
        return target[prop];
      },
    });
    client = factory(widget, {});
    client.addDispose(Disposable.create(async () => {
      if (root) {
        await fs.remove(root.path.toString());
      }
    }));
    await client.attached.promise;
  });

  afterAll(() => {
    client.dispose();
    server.close();
    proxy.close();
  });

  it('Render Terminal', () => {
    expect(client.ready).toBeTruthy();
  });

  it('Terminal Pid And Name', () => {
    expect(client.name).toEqual(defaultName);
  });

  it('Focus Terminal which is ready', async () => {
    client.focus();
  });

  it('Terminal SelectAll', () => {
    client.selectAll();
    const position = client.term.getSelectionPosition();
    expect(position && position.endColumn)
      .toEqual(client.term.cols);
  });

  it('Terminal getSelection', async () => {
    await client.attached.promise;
    client.sendText('pwd\r');
    await delay(500);
    client.selectAll();
    const selection = client.getSelection();
    expect(selection.includes('pwd')).toBeTruthy();
  });

  it('Terminal Send Text', async (done) => {
    await client.attached.promise;
    client.clear();
    await client.sendText('pwd\r');
    await delay(500);

    const line = client.term.buffer.active.getLine(0);
    const lineText = (line && line.translateToString()) || '';
    expect(lineText.trim().length).toBeGreaterThan(0);
    done();
  });

  it('Terminal Find Next', async () => {
    const searched = 'pwd';
    client.findNext(searched);
    expect(client.term.getSelection()).toEqual(searched);
  });

  it('Terminal Dispose', (done) => {
    client.onExit((e) => {
      expect(e.code).toBe(-1);
      expect(e.id).toBe(client.id);
      done();
    });
    client['_attachAddon']._onExit.fire(-1);
    client.dispose();

    expect(client.disposed).toBeTruthy();
    expect(client.container.children.length).toBe(0);
  });

  it('After Terminal Dispose', async (done) => {
    await client.attached.promise;
    client.sendText('pwd\r');
    client.focus();
    client.selectAll();
    client.updateTheme();
    client.clear();
    done();
  });
});
