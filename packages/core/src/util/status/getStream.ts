import path from 'node:path';

import type { PushStatusCommand } from '../../interfaces/MQTTPacketResponse/print';
import { getBambuStudiosFolder } from '../getBambuStudiosFolder';

export function getStream(ipcam: PushStatusCommand['ipcam']) {
  if (ipcam.ipcam_dev === '0' || ipcam.ipcam_record === 'disable') {
    return;
  }

  const bambuPath = getBambuStudiosFolder();

  if (!bambuPath) {
    return;
  }

  return path.resolve(bambuPath, 'cameratools', 'ffmpeg.sdp');
}
