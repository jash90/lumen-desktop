import type { Action } from '../../shared/models';
import type { LightingFacade } from '../providers/LightingFacade';

/**
 * Executes an Action against whatever hubs are live.
 *
 * This lives in the main process on purpose: a toggle needs the current state to
 * invert it, and the tray, global shortcuts and quick actions all fire while the
 * renderer may not even exist.
 */
export interface ActionRunner {
  run(action: Action): Promise<void>;
}

export function createActionRunner(api: LightingFacade): ActionRunner {
  return {
    async run(action) {
      switch (action.kind) {
        case 'toggleLight':
          return api.setLightPower(action.id, !api.getLight(action.id).isOn);

        case 'toggleRoom':
          return api.setRoomPower(action.id, !api.getRoom(action.id).isOn);

        case 'setRoomBrightness':
          return api.setRoomBrightness(action.id, action.brightness);

        case 'activateScene':
          return api.activateScene(action.id);

        case 'allOff': {
          // Everything, on every connected hub — half a dark house is not what
          // "all off" means. One request per room rather than per bulb; lights
          // outside any room have no group to go through and go individually.
          await Promise.all(api.getRooms().map((room) => api.setRoomPower(room.id, false)));
          const loose = api.getLights().filter((light) => light.roomId === null && light.isOn);
          await Promise.all(loose.map((light) => api.setLightPower(light.id, false)));
          return;
        }
      }
    },
  };
}
