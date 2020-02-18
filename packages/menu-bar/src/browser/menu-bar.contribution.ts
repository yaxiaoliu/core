import { Autowired } from '@ali/common-di';
import { CommandContribution, CommandRegistry, CommandService } from '@ali/ide-core-common';
import { Domain } from '@ali/ide-core-common/lib/di-helper';
import { localize } from '@ali/ide-core-common';
import { ComponentContribution, ComponentRegistry } from '@ali/ide-core-browser/lib/layout';
import { IMenuRegistry, NextMenuContribution as MenuContribution, MenuId } from '@ali/ide-core-browser/lib/menu/next';

import { MenuBar } from './menu-bar.view';

@Domain(CommandContribution, MenuContribution, ComponentContribution)
export class MenuBarContribution implements CommandContribution, MenuContribution, ComponentContribution {

  @Autowired(CommandService)
  private readonly commandService: CommandService;

  registerComponent(registry: ComponentRegistry) {
    registry.register('@ali/ide-menu-bar', {
      id: 'ide-menu-bar',
      component: MenuBar,
    }, {
      size: 27,
    });
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand({
      id: 'view.outward.right-panel.hide',
    }, {
      execute: () => {
        this.commandService.executeCommand('main-layout.right-panel.toggle', false);
      },
    });
    commands.registerCommand({
      id: 'view.outward.right-panel.show',
    }, {
      execute: (size?: number) => {
        this.commandService.executeCommand('main-layout.right-panel.toggle', true, size);
      },
    });
    commands.registerCommand({
      id: 'view.outward.left-panel.hide',
    }, {
      execute: () => {
        this.commandService.executeCommand('main-layout.left-panel.toggle', false);
      },
    });
    commands.registerCommand({
      id: 'view.outward.left-panel.show',
    }, {
      execute: (size?: number) => {
        this.commandService.executeCommand('main-layout.left-panel.toggle', true, size);
      },
    });
  }

  registerNextMenus(menus: IMenuRegistry): void {
    menus.registerMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: 'view.outward.right-panel.hide',
        label: localize('menu-bar.view.outward.right-panel.hide'),
      },
      when: 'rightPanelVisible',
      group: '5_panel',
    });

    menus.registerMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: 'view.outward.right-panel.show',
        label: localize('menu-bar.view.outward.right-panel.show'),
      },
      when: '!rightPanelVisible',
      group: '5_panel',
    });

    menus.registerMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: 'view.outward.left-panel.hide',
        label: localize('menu-bar.view.outward.left-panel.hide'),
      },
      when: 'leftPanelVisible',
      group: '5_panel',
    });

    menus.registerMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: 'view.outward.left-panel.show',
        label: localize('menu-bar.view.outward.left-panel.show'),
      },
      when: '!leftPanelVisible',
      group: '5_panel',
    });
  }
}
