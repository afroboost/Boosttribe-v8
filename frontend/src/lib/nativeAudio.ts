import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Pont vers le plugin natif Android `AudioSession` (Phase 3).
 * HORS Capacitor (navigateur web), TOUT est un no-op → comportement web strictement identique.
 */
export type NativeAudioMode = 'music' | 'voice' | 'simultaneous';

interface AudioSessionPlugin {
  setMode(options: { mode: NativeAudioMode }): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  setSpeakerphoneOn(options: { on: boolean }): Promise<void>;
  isHeadsetConnected(): Promise<{ connected: boolean }>;
}

const AudioSession = registerPlugin<AudioSessionPlugin>('AudioSession');

export function isNativeAudio(): boolean {
  return Capacitor.isNativePlatform();
}

export async function setAudioMode(mode: NativeAudioMode): Promise<void> {
  if (!isNativeAudio()) return;
  try { await AudioSession.setMode({ mode }); } catch { /* no-op */ }
}

export async function activateAudioSession(): Promise<void> {
  if (!isNativeAudio()) return;
  try { await AudioSession.activate(); } catch { /* no-op */ }
}

export async function deactivateAudioSession(): Promise<void> {
  if (!isNativeAudio()) return;
  try { await AudioSession.deactivate(); } catch { /* no-op */ }
}

export async function nativeHeadsetConnected(): Promise<boolean | null> {
  if (!isNativeAudio()) return null;
  try { return (await AudioSession.isHeadsetConnected()).connected; } catch { return null; }
}

export async function setSpeakerphone(on: boolean): Promise<void> {
  if (!isNativeAudio()) return;
  try { await AudioSession.setSpeakerphoneOn({ on }); } catch { /* no-op */ }
}
