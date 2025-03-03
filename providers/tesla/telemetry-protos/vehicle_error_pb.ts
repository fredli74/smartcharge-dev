// @generated by protoc-gen-es v2.2.3 with parameter "target=ts"
// @generated from file vehicle_error.proto (package telemetry.vehicle_error, syntax proto3)
/* eslint-disable */

import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv1";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv1";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { file_google_protobuf_timestamp } from "@bufbuild/protobuf/wkt";
import type { Message } from "@bufbuild/protobuf";

/**
 * Describes the file vehicle_error.proto.
 */
export const file_vehicle_error: GenFile = /*@__PURE__*/
  fileDesc("ChN2ZWhpY2xlX2Vycm9yLnByb3RvEhd0ZWxlbWV0cnkudmVoaWNsZV9lcnJvciKDAQoNVmVoaWNsZUVycm9ycxI1CgZlcnJvcnMYASADKAsyJS50ZWxlbWV0cnkudmVoaWNsZV9lcnJvci5WZWhpY2xlRXJyb3ISLgoKY3JlYXRlZF9hdBgCIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXASCwoDdmluGAMgASgJIsYBCgxWZWhpY2xlRXJyb3ISLgoKY3JlYXRlZF9hdBgBIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXASDAoEbmFtZRgCIAEoCRI9CgR0YWdzGAMgAygLMi8udGVsZW1ldHJ5LnZlaGljbGVfZXJyb3IuVmVoaWNsZUVycm9yLlRhZ3NFbnRyeRIMCgRib2R5GAQgASgJGisKCVRhZ3NFbnRyeRILCgNrZXkYASABKAkSDQoFdmFsdWUYAiABKAk6AjgBQi9aLWdpdGh1Yi5jb20vdGVzbGFtb3RvcnMvZmxlZXQtdGVsZW1ldHJ5L3Byb3Rvc2IGcHJvdG8z", [file_google_protobuf_timestamp]);

/**
 * VehicleErrors is a collection of errors for a single vehicle.
 *
 * @generated from message telemetry.vehicle_error.VehicleErrors
 */
export type VehicleErrors = Message<"telemetry.vehicle_error.VehicleErrors"> & {
  /**
   * @generated from field: repeated telemetry.vehicle_error.VehicleError errors = 1;
   */
  errors: VehicleError[];

  /**
   * @generated from field: google.protobuf.Timestamp created_at = 2;
   */
  createdAt?: Timestamp;

  /**
   * @generated from field: string vin = 3;
   */
  vin: string;
};

/**
 * Describes the message telemetry.vehicle_error.VehicleErrors.
 * Use `create(VehicleErrorsSchema)` to create a new message.
 */
export const VehicleErrorsSchema: GenMessage<VehicleErrors> = /*@__PURE__*/
  messageDesc(file_vehicle_error, 0);

/**
 * VehicleError is a single error
 *
 * @generated from message telemetry.vehicle_error.VehicleError
 */
export type VehicleError = Message<"telemetry.vehicle_error.VehicleError"> & {
  /**
   * @generated from field: google.protobuf.Timestamp created_at = 1;
   */
  createdAt?: Timestamp;

  /**
   * @generated from field: string name = 2;
   */
  name: string;

  /**
   * @generated from field: map<string, string> tags = 3;
   */
  tags: { [key: string]: string };

  /**
   * @generated from field: string body = 4;
   */
  body: string;
};

/**
 * Describes the message telemetry.vehicle_error.VehicleError.
 * Use `create(VehicleErrorSchema)` to create a new message.
 */
export const VehicleErrorSchema: GenMessage<VehicleError> = /*@__PURE__*/
  messageDesc(file_vehicle_error, 1);

