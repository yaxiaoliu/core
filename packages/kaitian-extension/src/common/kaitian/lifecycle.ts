import { ExtensionCandidate } from '@ali/ide-core-common';

export interface IMainThreadLifeCycle {
  $setExtensionDir(path: string): void;

  $setExtensionCandidate(candidate: ExtensionCandidate[]): void;
}

export interface IExtHostLifeCycle {
  setExtensionDir(path: string): void;
  setExtensionCandidate(candidate: ExtensionCandidate[]): void;
}
