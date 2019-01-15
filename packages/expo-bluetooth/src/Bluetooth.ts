import { EventEmitter, Platform, Subscription } from 'expo-core';
import { UnavailabilityError } from 'expo-errors';

import {
  CentralState,
  PeripheralState,
  Base64,
  UUID,
  Identifier,
  TransactionId,
  NodeInterface,
  DescriptorInterface,
  NativeEventData,
  ErrorInterface,
  CharacteristicInterface,
  ServiceInterface,
  AdvertismentDataInterface,
  PeripheralInterface,
  TransactionType,
  PeripheralFoundCallback,
  StateUpdatedCallback,
  ScanSettings,
  Central,
  CharacteristicProperty,
} from './Bluetooth.types';

export {
  CentralState,
  PeripheralState,
  Base64,
  UUID,
  Identifier,
  TransactionId,
  NodeInterface,
  DescriptorInterface,
  NativeEventData,
  ErrorInterface,
  CharacteristicInterface,
  ServiceInterface,
  AdvertismentDataInterface,
  PeripheralInterface,
  TransactionType,
  PeripheralFoundCallback,
  StateUpdatedCallback,
  ScanSettings,
  Central,
  CharacteristicProperty,
};
import ExpoBluetooth from './ExpoBluetooth';
// const ExpoBluetooth: {
//   addListener: (eventName: string) => void;
//   removeListeners: (count: number) => void;
//   [prop: string]: any;
// } = {
//   addListener() {},
//   removeListeners() {},
//   Events: {},
// };

let transactions: { [transactionId: string]: any } = {};

const eventEmitter = new EventEmitter(ExpoBluetooth);

function _validateUUID(uuid: string | undefined): string {
  if (uuid === undefined || (typeof uuid !== 'string' && uuid === '')) {
    throw new Error('Bluetooth: Invalid UUID provided!');
  }
  return uuid;
}

export const { Events } = ExpoBluetooth;

// Manage all of the bluetooth information.
let _peripherals: { [peripheralId: string]: PeripheralInterface } = {};

let _advertisements: any = {};

const multiEventHandlers: any = {
  [Events.CENTRAL_DID_DISCOVER_PERIPHERAL_EVENT]: [],
  [Events.CENTRAL_DID_UPDATE_STATE_EVENT]: [],
  everything: [],
  centralState: [],
};

export async function startScanAsync(scanSettings: ScanSettings = {}): Promise<Subscription> {
  if (!ExpoBluetooth.startScanAsync) {
    throw new UnavailabilityError('Bluetooth', 'startScanAsync');
  }

  const { serviceUUIDsToQuery = [], scanningOptions = {}, callback } = scanSettings;
  /* Prevents the need for CBCentralManagerScanOptionAllowDuplicatesKey in the info.plist */
  const serviceUUIDsWithoutDuplicates = [...new Set(serviceUUIDsToQuery)];
  /* iOS:
   *
   * Although strongly discouraged,
   * if <i>serviceUUIDs</i> is <i>nil</i> all discovered peripherals will be returned.
   * If the central is already scanning with different
   * <i>serviceUUIDs</i> or <i>options</i>, the provided parameters will replace them.
   */
  await ExpoBluetooth.startScanAsync(serviceUUIDsWithoutDuplicates, scanningOptions);

  if (callback instanceof Function) {
    multiEventHandlers[Events.CENTRAL_DID_DISCOVER_PERIPHERAL_EVENT].push(callback);
  }

  return {
    remove() {
      const index = multiEventHandlers[Events.CENTRAL_DID_DISCOVER_PERIPHERAL_EVENT].indexOf(
        callback
      );
      if (index != -1) {
        multiEventHandlers[Events.CENTRAL_DID_DISCOVER_PERIPHERAL_EVENT].splice(index, 1);
      }
    },
  };
}

export async function stopScanAsync(): Promise<void> {
  if (!ExpoBluetooth.stopScanAsync) {
    throw new UnavailabilityError('Bluetooth', 'stopScanAsync');
  }

  // Remove all callbacks
  multiEventHandlers[Events.CENTRAL_DID_DISCOVER_PERIPHERAL_EVENT] = [];

  await ExpoBluetooth.stopScanAsync();
}

// Avoiding using "start" in passive method names
export async function observeUpdatesAsync(callback: (updates: any) => void): Promise<Subscription> {
  multiEventHandlers.everything.push(callback);

  return {
    remove() {
      const index = multiEventHandlers.everything.indexOf(callback);
      if (index != -1) {
        multiEventHandlers.everything.splice(index, 1);
      }
    },
  };
}

export async function observeStateAsync(callback: StateUpdatedCallback): Promise<Subscription> {
  const central = await getCentralAsync();
  callback(central.state);

  // TODO: Bacon: Is this just automatic?
  multiEventHandlers[Events.CENTRAL_DID_UPDATE_STATE_EVENT].push(callback);

  return {
    remove() {
      const index = multiEventHandlers[Events.CENTRAL_DID_UPDATE_STATE_EVENT].indexOf(callback);
      if (index != -1) {
        multiEventHandlers[Events.CENTRAL_DID_UPDATE_STATE_EVENT].splice(index, 1);
      }
    },
  };
}

export async function connectAsync(options: {
  uuid: string;
  timeout?: number;
  options?: any;
}): Promise<PeripheralInterface> {
  if (!ExpoBluetooth.connectAsync) {
    throw new UnavailabilityError('Bluetooth', 'connectAsync');
  }
  const peripheralUUID = _validateUUID(options.uuid);
  return new Promise((resolve, reject) => {
    const transactionId = createTransactionId({ peripheralUUID }, TransactionType.connect);

    let timeoutTag: number | undefined;
    if (options.timeout) {
      timeoutTag = setTimeout(() => {
        disconnectAsync({ uuid: peripheralUUID });
        delete transactions[transactionId];
        reject('request timeout');
      }, options.timeout);
    }

    transactions[transactionId] = {
      resolve(...props) {
        clearTimeout(timeoutTag);
        return resolve(...props);
      },
      reject(...props) {
        clearTimeout(timeoutTag);
        return reject(...props);
      },
    };

    ExpoBluetooth.connectAsync(options);
  });
}

export async function disconnectAsync(options: { uuid: string }): Promise<any> {
  if (!ExpoBluetooth.disconnectAsync) {
    throw new UnavailabilityError('Bluetooth', 'disconnectAsync');
  }
  const peripheralUUID = _validateUUID(options.uuid);
  return new Promise((resolve, reject) => {
    const transactionId = createTransactionId({ peripheralUUID }, TransactionType.disconnect);
    transactions[transactionId] = { resolve, reject };
    ExpoBluetooth.disconnectAsync(options);
  });
}


class BluetoothError extends Error implements ErrorInterface {
  code: string;
  domain?: string | null;
  reason?: string | null;
  suggestion?: string | null;
  underlayingError?: string | null;

  constructor({ message, code, domain, reason, suggestion, underlayingError }: ErrorInterface) {
    super(`expo-bluetooth: ${message}`);
    this.code = code;
    this.domain = domain;
    this.reason = reason;
    this.suggestion = suggestion;
    this.underlayingError = underlayingError;
  }
}

/* TODO: Bacon: Add a return type */
export async function readDescriptorAsync({ peripheralUUID, serviceUUID, characteristicUUID, descriptorUUID }: any): Promise<Base64 | undefined> {
  const output = await updateDescriptorAsync({ peripheralUUID, serviceUUID, characteristicUUID, descriptorUUID }, CharacteristicProperty.Read);

  if (output && output.descriptor) {
    const descriptor: DescriptorInterface = output.descriptor;
    return descriptor.value;
  }

  throw new Error(`Not able to read descriptor: ${JSON.stringify({ peripheralUUID, serviceUUID, characteristicUUID, descriptorUUID })}`)
}

/* TODO: Bacon: Add a return type */
export async function writeDescriptorAsync({ peripheralUUID, serviceUUID, characteristicUUID, descriptorUUID, data }: any): Promise<any> {
  return await updateDescriptorAsync({ peripheralUUID, serviceUUID, characteristicUUID, descriptorUUID, data }, CharacteristicProperty.Write);
}

/* TODO: Bacon: Add a return type */
export async function readCharacteristicAsync({ peripheralUUID, serviceUUID, characteristicUUID }: any): Promise<Base64 | null> {
  const output = await updateCharacteristicAsync({ peripheralUUID, serviceUUID, characteristicUUID }, CharacteristicProperty.Read);
  if (output && output.characteristic) {
    const characteristic: CharacteristicInterface = output.characteristic;
    return characteristic.value;
  }

  throw new Error(`Not able to read characteristic: ${JSON.stringify({ peripheralUUID, serviceUUID, characteristicUUID })}`)
}

/* TODO: Bacon: Add a return type */
export async function writeCharacteristicAsync({ peripheralUUID, serviceUUID, characteristicUUID, data }: any): Promise<any> {
  return await updateCharacteristicAsync({ peripheralUUID, serviceUUID, characteristicUUID, data }, CharacteristicProperty.Write);
}

/* TODO: Bacon: Why would anyone use this? */
/* TODO: Bacon: Test if this works */
/* TODO: Bacon: Add a return type */
export async function writeCharacteristicWithoutResponseAsync({ peripheralUUID, serviceUUID, characteristicUUID, data }: any): Promise<any> {
  return await updateCharacteristicAsync({ peripheralUUID, serviceUUID, characteristicUUID, data }, CharacteristicProperty.WriteWithoutResponse);
}

// export async function setCharacteristicShouldNotifyAsync({ isEnabled, peripheralUUID, serviceUUID, characteristicUUID, data }: any): Promise<any> {
//   return await updateCharacteristicAsync({ isEnabled, peripheralUUID, serviceUUID, characteristicUUID, data }, CharacteristicProperty.Notify);
// }

// export async function setCharacteristicShouldIndicateAsync({ isEnabled, peripheralUUID, serviceUUID, characteristicUUID, data }: any): Promise<any> {
//   return await updateCharacteristicAsync({ isEnabled, peripheralUUID, serviceUUID, characteristicUUID, data }, CharacteristicProperty.Indicate);
// }

async function updateCharacteristicAsync(options: any, characteristicProperties: CharacteristicProperty): Promise<any> {
  if (!ExpoBluetooth.updateCharacteristicAsync) {
    throw new UnavailabilityError('Bluetooth', 'updateCharacteristicAsync');
  }
  _validateUUID(options.peripheralUUID);
  _validateUUID(options.serviceUUID);
  _validateUUID(options.characteristicUUID);
  return new Promise((resolve, reject) => {
    const expectResponse = characteristicPropertyUpdateExpectsResponse(characteristicProperties);
    if (expectResponse) {
      const transactionId = createTransactionId(options, characteristicProperties);
      transactions[transactionId] = { resolve, reject };
    } else {
      resolve();
    }
    ExpoBluetooth.updateCharacteristicAsync({ ...options, characteristicProperties });
  });
}

function characteristicPropertyUpdateExpectsResponse(characteristicProperty: CharacteristicProperty): boolean {
  if (characteristicProperty === CharacteristicProperty.WriteWithoutResponse) {
    return false;
  }
  return true;
}

async function updateDescriptorAsync(options: any, characteristicProperties: CharacteristicProperty.Read | CharacteristicProperty.Write): Promise<any> {
  if (!ExpoBluetooth.updateDescriptorAsync) {
    throw new UnavailabilityError('Bluetooth', 'updateDescriptorAsync');
  }
  _validateUUID(options.peripheralUUID);
  _validateUUID(options.serviceUUID);
  _validateUUID(options.characteristicUUID);
  _validateUUID(options.descriptorUUID);
  return new Promise((resolve, reject) => {
    const transactionId = createTransactionId(options, characteristicProperties);
    transactions[transactionId] = { resolve, reject };
    ExpoBluetooth.updateDescriptorAsync({...options, characteristicProperties});
  });
}

export async function readRSSIAsync(peripheralUUID: UUID): Promise<any> {
  if (!ExpoBluetooth.readRSSIAsync) {
    throw new UnavailabilityError('Bluetooth', 'readRSSIAsync');
  }
  _validateUUID(peripheralUUID);

  return new Promise((resolve, reject) => {
    const transactionId = createTransactionId({ peripheralUUID }, TransactionType.rssi);
    transactions[transactionId] = { resolve, reject };
    ExpoBluetooth.readRSSIAsync({ uuid: peripheralUUID });
  });
}

export async function getPeripheralsAsync(): Promise<any[]> {
  if (!ExpoBluetooth.getPeripheralsAsync) {
    throw new UnavailabilityError('Bluetooth', 'getPeripheralsAsync');
  }
  // TODO: Bacon: Do we need to piggy back and get the delegate results? Or is the cached version accurate enough to return?
  return await ExpoBluetooth.getPeripheralsAsync({});
  // return new Promise((resolve, reject) => {
  //   getPeripheralsAsyncCallbacks.push({ resolve, reject });
  //   ExpoBluetooth.getPeripheralsAsync(options);
  // })
}

export function getPeripherals(): any {
  return _peripherals;
}

export function getPeripheralForId(id: string): any {
  const uuid = peripheralIdFromId(id);
  return _peripherals[uuid];
}

export async function getCentralAsync(): Promise<any> {
  if (!ExpoBluetooth.getCentralAsync) {
    throw new UnavailabilityError('Bluetooth', 'getCentralAsync');
  }
  return await ExpoBluetooth.getCentralAsync();
}

export async function isScanningAsync(): Promise<any> {
  const { isScanning } = await getCentralAsync();
  return isScanning;
}

// TODO: Bacon: Add serviceUUIDs
export async function discoverServicesForPeripheralAsync(options: {
  id: string;
  serviceUUIDsToQuery?: UUID[];
}): Promise<{ peripheral: PeripheralInterface }> {
  return await discoverAsync(options);
}

export async function discoverCharacteristicsForServiceAsync({
  id,
}): Promise<{ service: ServiceInterface }> {
  return await discoverAsync({ id });
}

export async function discoverDescriptorsForCharacteristicAsync({
  id,
}): Promise<{ peripheral: PeripheralInterface; characteristic: CharacteristicInterface }> {
  return await discoverAsync({ id });
}

export async function loadPeripheralAsync(
  { id },
  skipConnecting: boolean = false
): Promise<PeripheralInterface> {
  const peripheralId = peripheralIdFromId(id);
  const peripheral = getPeripherals()[peripheralId];
  if (!peripheral) {
    throw new Error('Not a peripheral ' + peripheralId);
  }

  if (peripheral.state !== 'connected') {
    if (!skipConnecting) {
      await connectAsync({ uuid: peripheralId });
      return loadPeripheralAsync({ id }, true);
    } else {
      // This should never be called because in theory connectAsync would throw an error.
    }
  } else if (peripheral.state === 'connected') {
    await loadChildrenRecursivelyAsync({ id: peripheralId });
  }

  // In case any updates occured during this function.
  return getPeripherals()[peripheralId];
}

export async function loadChildrenRecursivelyAsync({ id }): Promise<Array<any>> {
  const components = id.split('|');
  console.log({components});
  if (components.length === 4) {
    // Descriptor ID
    throw new Error('Descriptors have no children');
  } else if (components.length === 3) {
    // Characteristic ID
    console.log('Load Characteristic ', id);
    const {
      characteristic: { descriptors },
    } = await discoverDescriptorsForCharacteristicAsync({ id });
    return descriptors;
  } else if (components.length === 2) {
    // Service ID
    console.log('Load Service ', id);
    const {
      service,
    } = await discoverCharacteristicsForServiceAsync({ id });
    console.log("LOADED CHARACTERISTICS FROM SERVICE", service);
    return await Promise.all(
      service.characteristics.map(characteristic => loadChildrenRecursivelyAsync(characteristic))
    );
  } else if (components.length === 1) {
    // Peripheral ID
    console.log('Load Peripheral ', id);
    const {
      peripheral: { services },
    } = await discoverServicesForPeripheralAsync({ id });
    return await Promise.all(services.map(service => loadChildrenRecursivelyAsync(service)));
  } else {
    throw new Error(`Unknown ID ${id}`);
  }
}

addListener(({ data, event }: { data: NativeEventData; event: string }) => {
  const { transactionId, peripheral, peripherals, central, advertisementData, rssi, error } = data;

  // console.log("GOT EVENT: ", {data: !!data, event});
  if (central) {
    // _central = central;
  }

  if (peripheral) {
    if (advertisementData) {
      updateAdvertismentDataStore(peripheral.id, advertisementData);
      peripheral.advertisementData = advertisementData;
    }
    if (rssi) {
      peripheral.rssi = rssi;
    }
    updateStateWithPeripheral(peripheral);
  }

  if (peripherals) {
    for (const peripheral of peripherals) {
      updateStateWithPeripheral(peripheral);
    }
  }

  if (transactionId) {
    if (error == null) {
      firePeripheralObservers();
    }
    if (transactionId in transactions) {
      
      const { resolve, reject, callbacks } = transactions[transactionId];

      console.log('Handle: ', { transactionId, transactions: Object.keys(transactions), event, data: Object.keys(data) });

      if (callbacks) {
        for (let callback of callbacks) {
          if (callback instanceof Function) {
            // TODO: Bacon: should we pass back an error? Will one ever exist?
            callback(data);
          } else {
            const { resolve, reject } = callback;
            if (error) {
              reject(new BluetoothError(error));
            } else {
              const { error, ...outputData } = data;
              resolve(outputData);
            }
            removeCallbackForTransactionId(callback, transactionId);
          }
        }
        return;
      } else if (resolve && reject) {        
        if (error) {
          reject(new BluetoothError(error));
        } else {
          const { error, ...outputData } = data;
          resolve(outputData);
        }
        delete transactions[transactionId];
        return;
      } else {
        console.log('Throwing Error because no callback is found for transactionId: ', {
          data,
          transactions,
        });
        throw new Error('Unknown error');
      }
    } else {
      console.log('Unhandled transactionId', { transactionId, transactions: Object.keys(transactions), event, data: Object.keys(data) });
      // throw new Error('Unhandled transactionId');
    }
  } else {
    switch (event) {
      case Events.CENTRAL_DID_DISCOVER_PERIPHERAL_EVENT:
        fireMultiEventHandlers(event, { central, peripheral });
        return;
      case Events.CENTRAL_DID_UPDATE_STATE_EVENT:
        console.log('CENTRAL DID UPDATE STATE', event);

        if (!central) {
          throw new Error('EXBluetooth: Central not defined while processing: ' + event);
        }
        // Currently this is iOS only
        if (Platform.OS === 'ios') {
          const peripheralsAreStillValid =
            central.state == CentralState.PoweredOff || central.state === CentralState.PoweredOn;
          if (!peripheralsAreStillValid) {
            // Clear caches
            _peripherals = {};
            firePeripheralObservers();
          }
        }

        for (const callback of multiEventHandlers[event]) {
          callback(central.state);
        }

        return;
      case Events.CENTRAL_DID_RETRIEVE_CONNECTED_PERIPHERALS_EVENT:
      case Events.CENTRAL_DID_RETRIEVE_PERIPHERALS_EVENT:
        return;
      default:
        throw new Error('EXBluetooth: Unhandled event: ' + event);
    }
  }
});

// Interactions
function createTransactionId(
  options: {
    peripheralUUID?: string;
    serviceUUID?: string;
    characteristicUUID?: string;
    descriptorUUID?: string;
  },
  transactionType: TransactionType | CharacteristicProperty
): string {
  let targets: string[] = [transactionType];

  if (options.peripheralUUID) targets.push(options.peripheralUUID);
  if (options.serviceUUID) targets.push(options.serviceUUID);
  if (options.characteristicUUID) targets.push(options.characteristicUUID);
  if (options.descriptorUUID) targets.push(options.descriptorUUID);
  return targets.join('|');
}

function addListener(listener: (event: any) => void): Subscription {
  const subscription = eventEmitter.addListener(ExpoBluetooth.BLUETOOTH_EVENT, listener);
  return subscription;
}

// TODO: Bacon: How do we plan on calling this...
function removeAllListeners(): void {
  eventEmitter.removeAllListeners(ExpoBluetooth.BLUETOOTH_EVENT);
}

function updateStateWithPeripheral(peripheral: PeripheralInterface) {
  const {
    [peripheral.id]: currentPeripheral = {
      discoveryTimestamp: Date.now(),
      advertisementData: undefined,
      rssi: null,
    },
    ...others
  } = _peripherals;
  _peripherals = {
    ...others,
    [peripheral.id]: {
      discoveryTimestamp: currentPeripheral.discoveryTimestamp,
      advertisementData: currentPeripheral.advertisementData,
      rssi: currentPeripheral.rssi,
      // ...currentPeripheral,
      ...peripheral,
    },
  };
}

function updateAdvertismentDataStore(peripheralId: string, advertisementData: any) {
  const { [peripheralId]: current = {}, ...others } = _advertisements;
  _advertisements = {
    ...others,
    [peripheralId]: {
      peripheralId,
      // ...current,
      ...advertisementData,
    },
  };
}

function firePeripheralObservers() {
  for (const subscription of multiEventHandlers.everything) {
    subscription({ peripherals: getPeripherals() });
  }
}

function fireMultiEventHandlers(
  event: string,
  { central, peripheral }: { central?: Central | null; peripheral?: PeripheralInterface | null }
) {
  for (const callback of multiEventHandlers[event]) {
    callback({ central, peripheral });
  }
}

function peripheralIdFromId(id: string): string {
  return id.split('|')[0];
}

async function discoverAsync(options: { id: string; serviceUUIDsToQuery?: UUID[] }): Promise<any> {
  if (!ExpoBluetooth.discoverAsync) {
    throw new UnavailabilityError('Bluetooth', 'discoverAsync');
  }

  const { serviceUUIDsToQuery, id } = options;

  const [peripheralUUID, serviceUUID, characteristicUUID, descriptorUUID] = id.split('|');
  const transactionId = createTransactionId(
    { peripheralUUID, serviceUUID, characteristicUUID, descriptorUUID },
    TransactionType.scan
    );
    
  return new Promise((resolve, reject) => {
      
    console.log("discoverAsync(): ", transactionId)
    addCallbackForTransactionId({ resolve, reject }, transactionId);
    
    ExpoBluetooth.discoverAsync({
      peripheralUUID,
      serviceUUID,
      characteristicUUID,
      serviceUUIDsToQuery,
    });

  });
}

function ensureCallbacksArrayForTransactionId(transactionId) {
  if (!(transactionId in transactions) || !Array.isArray(transactions[transactionId].callbacks)) {
    transactions[transactionId] = { callbacks: [] };
  }
}

function addCallbackForTransactionId(callback, transactionId) {
  ensureCallbacksArrayForTransactionId(transactionId);
  transactions[transactionId].callbacks.push(callback);
}

function removeCallbackForTransactionId(callback, transactionId) {
  ensureCallbacksArrayForTransactionId(transactionId);

  const index = transactions[transactionId].callbacks.indexOf(callback);

  if (index != -1) {
    transactions[transactionId].callbacks.splice(index, 1);

    if (transactions[transactionId].callbacks.length === 0) {
      delete transactions[transactionId];
    }
  }
}
