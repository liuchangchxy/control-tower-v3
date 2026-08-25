import { controlPlane } from './controlPlane.js';

export const getStatus = () => controlPlane.getStatus();
export const onProgress = controlPlane.onProgress.bind(controlPlane);
export const onLogLine = controlPlane.onLogLine.bind(controlPlane);
export const start = controlPlane.start.bind(controlPlane);
export const stop = controlPlane.stop.bind(controlPlane);
export const kill = controlPlane.kill.bind(controlPlane);
export const restart = controlPlane.restart.bind(controlPlane);
export const recoverFromState = controlPlane.recoverFromState.bind(controlPlane);
