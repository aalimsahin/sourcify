/* eslint-disable @typescript-eslint/no-var-requires */
// Functions here assume a folder structure like this:
// - contractFolderPath
//   - artifact.json
//   - metadata.json
//   - sources
//     - source1.sol
//     - source2.sol

import path from 'path';
import Web3 from 'web3';
import fs from 'fs';
import { ContextVariables, Match, SourcifyChain, verifyDeployed } from '../src';
import { checkFiles } from '../src';
import { expect } from 'chai';

/**
 *  Function to deploy contracts from provider unlocked accounts
 *
 * @returns the address of the deployed contract and the creator tx hash
 */
// TODO: ABI type definition
export async function deployFromAbiAndBytecode(
  web3: Web3,
  contractFolderPath: string,
  from: string,
  args?: any[]
) {
  const artifact = require(path.join(contractFolderPath, 'artifact.json'));
  // Deploy contract
  const contract = new web3.eth.Contract(artifact.abi);
  const deployment = contract.deploy({
    data: artifact.bytecode,
    arguments: args || [],
  });
  const gas = await deployment.estimateGas({ from });

  // If awaited, the send() Promise returns the contract instance.
  // We also need the tx hash so we need two seperate event listeners.
  const sendPromiEvent = deployment.send({
    from,
    gas,
  });

  const txHashPromise = new Promise<string>((resolve, reject) => {
    sendPromiEvent.on('transactionHash', (txHash) => {
      resolve(txHash);
    });
    sendPromiEvent.on('error', (error) => {
      reject(error);
    });
  });

  const contractAddressPromise = new Promise<string>((resolve, reject) => {
    sendPromiEvent.on('receipt', (receipt) => {
      if (!receipt.contractAddress) {
        reject(new Error('No contract address in receipt'));
      } else {
        resolve(receipt.contractAddress);
      }
    });
    sendPromiEvent.on('error', (error) => {
      reject(error);
    });
  });

  return Promise.all([contractAddressPromise, txHashPromise]);
}

/**
 * Checks the contract from metadata and source files under contractFolderPath and
 * verifies it on sourcifyChain at address.
 * The metadata must be at contractFolderPath/metadata.json and the sources must be under contractFolderPath/sources.
 */
export const checkAndVerifyDeployed = async (
  contractFolderPath: string,
  sourcifyChain: SourcifyChain,
  address: string,
  contextVariables?: ContextVariables,
  creatorTxHash?: string
) => {
  const checkedContracts = await checkFilesFromContractFolder(
    contractFolderPath
  );

  const match = await verifyDeployed(
    checkedContracts[0],
    sourcifyChain,
    address,
    contextVariables,
    creatorTxHash
  );
  return match;
};

/**
 * Creates a CheckedContract[] from the files under contractFolderPath.
 * The metadata must be at contractFolderPath/metadata.json and the sources must be under contractFolderPath/sources.
 */
export const checkFilesFromContractFolder = async (
  contractFolderPath: string
) => {
  const metadataPath = path.join(contractFolderPath, 'metadata.json');
  const metadataBuffer = fs.readFileSync(metadataPath);
  const metadataPathBuffer = { path: metadataPath, buffer: metadataBuffer };

  const sourceFilePaths = fs.readdirSync(
    path.join(contractFolderPath, 'sources')
  );
  const sourcePathBuffers = sourceFilePaths.map((sourceFilePath) => {
    const sourceBuffer = fs.readFileSync(
      path.join(contractFolderPath, 'sources', sourceFilePath)
    );
    return { path: sourceFilePath, buffer: sourceBuffer };
  });
  const checkedContracts = await checkFiles([
    metadataPathBuffer,
    ...sourcePathBuffers,
  ]);
  return checkedContracts;
};
/**
 * Combines both deploying and verifying a contract in a single function.
 * Returns the deployed address for assertions on Match.address
 */
export const deployCheckAndVerify = async (
  contractFolderPath: string,
  sourcifyChain: SourcifyChain,
  web3provider: Web3,
  from: string,
  args?: any[]
) => {
  const [deployedAddress] = await deployFromAbiAndBytecode(
    web3provider,
    contractFolderPath,
    from,
    args
  );
  const match = await checkAndVerifyDeployed(
    contractFolderPath,
    sourcifyChain,
    deployedAddress
  );
  return { match, deployedAddress };
};

// Sends a tx that changes the state
export async function callContractMethodWithTx(
  web3: Web3,
  contractFolderPath: string,
  contractAddress: string,
  methodName: string,
  from: string,
  args: any[]
) {
  const artifact = require(path.join(contractFolderPath, 'artifact.json'));
  const contract = new web3.eth.Contract(artifact.abi, contractAddress);
  const method = contract.methods[methodName](...args);
  const gas = await method.estimateGas({ from });

  const txReceipt = await method.send({
    from,
    gas,
  });

  return txReceipt;
}

export const expectMatch = (
  match: Match,
  status: string | null,
  address: string,
  libraryMap?: { [key: string]: string },
  message?: string
) => {
  try {
    expect(match.status).to.equal(status);
    expect(match.address).to.equal(address);
    if (libraryMap) {
      expect(match.libraryMap).to.deep.equal(libraryMap);
    }
    if (message) {
      expect(match.message).to.equal(message);
    }
  } catch (e) {
    console.log('Match: ', match);
    throw e;
  }
};
