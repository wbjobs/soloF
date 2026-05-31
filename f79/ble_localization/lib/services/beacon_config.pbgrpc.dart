import 'dart:core' as $core;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:grpc/grpc.dart' as $grpc;

class BeaconConfigMessage extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'BeaconConfig',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )
    ..aOS(1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'identifier')
    ..a<$core.double>(2, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'x', $pb.PbFieldType.OD)
    ..a<$core.double>(3, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'y', $pb.PbFieldType.OD)
    ..aOS(4, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'description')
    ..aInt64(5, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'updatedAt')
    ..aOS(6, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'updatedBy');

  BeaconConfigMessage._() : super();
  factory BeaconConfigMessage() => create();
  factory BeaconConfigMessage.fromBuffer($core.List<$core.int> i,
          [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(i, r);
  factory BeaconConfigMessage.fromJson($core.String i,
          [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(i, r);
  @$core.Deprecated('Using this can add significant overhead to your binary. '
      'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
      'Will be removed in next major version')
  BeaconConfigMessage clone() => BeaconConfigMessage()..mergeFromMessage(this);
  @$core.Deprecated('Using this can add significant overhead to your binary. '
      'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
      'Will be removed in next major version')
  BeaconConfigMessage copyWith(void Function(BeaconConfigMessage) updates) =>
      super.copyWith((message) => updates(message as BeaconConfigMessage))
          as BeaconConfigMessage;
  $pb.BuilderInfo get info_ => _i;
  @$core.pragma('dart2js:noInline')
  static BeaconConfigMessage create() => BeaconConfigMessage._();
  BeaconConfigMessage createEmptyInstance() => create();
  static $pb.PbList<BeaconConfigMessage> createRepeated() =>
      $pb.PbList<BeaconConfigMessage>();
  @$core.pragma('dart2js:noInline')
  static BeaconConfigMessage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<BeaconConfigMessage>(create);
  static BeaconConfigMessage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get identifier => $_getSZ(0);
  @$pb.TagNumber(1)
  set identifier($core.String v) {
    $_setString(0, v);
  }

  @$pb.TagNumber(2)
  $core.double get x => $_getN(1) as $core.double;
  @$pb.TagNumber(2)
  set x($core.double v) {
    $_setDouble(1, v);
  }

  @$pb.TagNumber(3)
  $core.double get y => $_getN(2) as $core.double;
  @$pb.TagNumber(3)
  set y($core.double v) {
    $_setDouble(2, v);
  }

  @$pb.TagNumber(4)
  $core.String get description => $_getSZ(3);
  @$pb.TagNumber(4)
  set description($core.String v) {
    $_setString(3, v);
  }

  @$pb.TagNumber(5)
  $pb.Int64 get updatedAt => $_getI64(4);
  @$pb.TagNumber(5)
  set updatedAt($pb.Int64 v) {
    $_setInt64(4, v);
  }

  @$pb.TagNumber(6)
  $core.String get updatedBy => $_getSZ(5);
  @$pb.TagNumber(6)
  set updatedBy($core.String v) {
    $_setString(5, v);
  }
}

class GetBeaconConfigsRequest extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'GetBeaconConfigsRequest',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )..aOS(1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'deviceId');

  GetBeaconConfigsRequest._() : super();
  factory GetBeaconConfigsRequest() => create();
  factory GetBeaconConfigsRequest.fromBuffer($core.List<$core.int> i,
          [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(i, r);
  factory GetBeaconConfigsRequest.fromJson($core.String i,
          [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(i, r);
  static GetBeaconConfigsRequest create() => GetBeaconConfigsRequest._();
  GetBeaconConfigsRequest createEmptyInstance() => create();

  @$pb.TagNumber(1)
  $core.String get deviceId => $_getSZ(0);
  @$pb.TagNumber(1)
  set deviceId($core.String v) {
    $_setString(0, v);
  }
}

class GetBeaconConfigsResponse extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'GetBeaconConfigsResponse',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )
    ..pc<BeaconConfigMessage>(
        1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'configs', $pb.PbFieldType.PM,
        subBuilder: BeaconConfigMessage.create)
    ..aInt64(2, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'version');

  GetBeaconConfigsResponse._() : super();
  factory GetBeaconConfigsResponse() => create();
  factory GetBeaconConfigsResponse.fromBuffer($core.List<$core.int> i,
          [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(i, r);
  static GetBeaconConfigsResponse create() => GetBeaconConfigsResponse._();
  GetBeaconConfigsResponse createEmptyInstance() => create();

  @$pb.TagNumber(1)
  $core.List<BeaconConfigMessage> get configs => $_getList(0);

  @$pb.TagNumber(2)
  $pb.Int64 get version => $_getI64(1);
  @$pb.TagNumber(2)
  set version($pb.Int64 v) {
    $_setInt64(1, v);
  }
}

class UpdateBeaconConfigRequest extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'UpdateBeaconConfigRequest',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )
    ..aOS(1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'deviceId')
    ..aOM<BeaconConfigMessage>(2, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'config',
        subBuilder: BeaconConfigMessage.create);

  UpdateBeaconConfigRequest._() : super();
  factory UpdateBeaconConfigRequest() => create();
  static UpdateBeaconConfigRequest create() => UpdateBeaconConfigRequest._();
  UpdateBeaconConfigRequest createEmptyInstance() => create();

  @$pb.TagNumber(1)
  $core.String get deviceId => $_getSZ(0);
  @$pb.TagNumber(1)
  set deviceId($core.String v) {
    $_setString(0, v);
  }

  @$pb.TagNumber(2)
  BeaconConfigMessage get config => $_getN(1) as BeaconConfigMessage;
  @$pb.TagNumber(2)
  set config(BeaconConfigMessage v) {
    setField(2, v);
  }
}

class UpdateBeaconConfigResponse extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'UpdateBeaconConfigResponse',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )
    ..aOB(1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'success')
    ..aOM<BeaconConfigMessage>(2, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'config',
        subBuilder: BeaconConfigMessage.create)
    ..aOS(3, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'message');

  UpdateBeaconConfigResponse._() : super();
  factory UpdateBeaconConfigResponse() => create();
  static UpdateBeaconConfigResponse create() => UpdateBeaconConfigResponse._();
  UpdateBeaconConfigResponse createEmptyInstance() => create();

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool v) {
    $_setBool(0, v);
  }

  @$pb.TagNumber(2)
  BeaconConfigMessage get config => $_getN(1) as BeaconConfigMessage;

  @$pb.TagNumber(3)
  $core.String get message => $_getSZ(2);
  @$pb.TagNumber(3)
  set message($core.String v) {
    $_setString(2, v);
  }
}

class SyncBeaconConfigsRequest extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'SyncBeaconConfigsRequest',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )
    ..aOS(1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'deviceId')
    ..pc<BeaconConfigMessage>(
        2, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'configs', $pb.PbFieldType.PM,
        subBuilder: BeaconConfigMessage.create)
    ..aInt64(3, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'clientVersion');

  SyncBeaconConfigsRequest._() : super();
  factory SyncBeaconConfigsRequest() => create();
  static SyncBeaconConfigsRequest create() => SyncBeaconConfigsRequest._();
  SyncBeaconConfigsRequest createEmptyInstance() => create();

  @$pb.TagNumber(1)
  $core.String get deviceId => $_getSZ(0);
  @$pb.TagNumber(1)
  set deviceId($core.String v) {
    $_setString(0, v);
  }

  @$pb.TagNumber(2)
  $core.List<BeaconConfigMessage> get configs => $_getList(1);

  @$pb.TagNumber(3)
  $pb.Int64 get clientVersion => $_getI64(2);
  @$pb.TagNumber(3)
  set clientVersion($pb.Int64 v) {
    $_setInt64(2, v);
  }
}

class SyncBeaconConfigsResponse extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'SyncBeaconConfigsResponse',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )
    ..aOB(1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'success')
    ..pc<BeaconConfigMessage>(
        2, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'updatedConfigs', $pb.PbFieldType.PM,
        subBuilder: BeaconConfigMessage.create)
    ..aInt64(3, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'serverVersion')
    ..aOS(4, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'message');

  SyncBeaconConfigsResponse._() : super();
  factory SyncBeaconConfigsResponse() => create();
  static SyncBeaconConfigsResponse create() => SyncBeaconConfigsResponse._();
  SyncBeaconConfigsResponse createEmptyInstance() => create();

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool v) {
    $_setBool(0, v);
  }

  @$pb.TagNumber(2)
  $core.List<BeaconConfigMessage> get updatedConfigs => $_getList(1);

  @$pb.TagNumber(3)
  $pb.Int64 get serverVersion => $_getI64(2);
  @$pb.TagNumber(3)
  set serverVersion($pb.Int64 v) {
    $_setInt64(2, v);
  }

  @$pb.TagNumber(4)
  $core.String get message => $_getSZ(3);
  @$pb.TagNumber(4)
  set message($core.String v) {
    $_setString(3, v);
  }
}

class SubscribeBeaconConfigUpdatesRequest extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'SubscribeBeaconConfigUpdatesRequest',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )
    ..aOS(1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'deviceId')
    ..aInt64(2, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'lastKnownVersion');

  SubscribeBeaconConfigUpdatesRequest._() : super();
  factory SubscribeBeaconConfigUpdatesRequest() => create();
  static SubscribeBeaconConfigUpdatesRequest create() =>
      SubscribeBeaconConfigUpdatesRequest._();
  SubscribeBeaconConfigUpdatesRequest createEmptyInstance() => create();

  @$pb.TagNumber(1)
  $core.String get deviceId => $_getSZ(0);
  @$pb.TagNumber(1)
  set deviceId($core.String v) {
    $_setString(0, v);
  }

  @$pb.TagNumber(2)
  $pb.Int64 get lastKnownVersion => $_getI64(1);
  @$pb.TagNumber(2)
  set lastKnownVersion($pb.Int64 v) {
    $_setInt64(1, v);
  }
}

class BeaconConfigUpdate extends $pb.GeneratedMessage {
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
    const $core.bool.fromEnvironment('protobuf.omit_message_names')
        ? ''
        : 'BeaconConfigUpdate',
    package: const $pb.PackageName(
      const $core.bool.fromEnvironment('protobuf.omit_message_names')
          ? ''
          : 'beaconconfig',
    ),
    createEmptyInstance: create,
  )
    ..aOM<BeaconConfigMessage>(1, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'config',
        subBuilder: BeaconConfigMessage.create)
    ..e<UpdateType>(2, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'type', $pb.PbFieldType.OE,
        defaultOrMaker: UpdateType.UNKNOWN,
        valueOf: UpdateType.valueOf,
        enumValues: UpdateType.values)
    ..aInt64(3, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'version')
    ..aOS(4, const $core.bool.fromEnvironment('protobuf.omit_field_names') ? '' : 'updatedBy');

  BeaconConfigUpdate._() : super();
  factory BeaconConfigUpdate() => create();
  static BeaconConfigUpdate create() => BeaconConfigUpdate._();
  BeaconConfigUpdate createEmptyInstance() => create();

  @$pb.TagNumber(1)
  BeaconConfigMessage get config => $_getN(0) as BeaconConfigMessage;

  @$pb.TagNumber(2)
  UpdateType get type => $_getN(1) as UpdateType;
  @$pb.TagNumber(2)
  set type(UpdateType v) {
    setField(2, v);
  }

  @$pb.TagNumber(3)
  $pb.Int64 get version => $_getI64(2);
  @$pb.TagNumber(3)
  set version($pb.Int64 v) {
    $_setInt64(2, v);
  }

  @$pb.TagNumber(4)
  $core.String get updatedBy => $_getSZ(3);
  @$pb.TagNumber(4)
  set updatedBy($core.String v) {
    $_setString(3, v);
  }
}

class UpdateType extends $pb.ProtobufEnum {
  static const UpdateType UNKNOWN = UpdateType._(0, _omitEnumNames ? '' : 'UNKNOWN');
  static const UpdateType CREATED = UpdateType._(1, _omitEnumNames ? '' : 'CREATED');
  static const UpdateType UPDATED = UpdateType._(2, _omitEnumNames ? '' : 'UPDATED');
  static const UpdateType DELETED = UpdateType._(3, _omitEnumNames ? '' : 'DELETED');

  static const $core.List<UpdateType> values = <UpdateType>[
    UNKNOWN,
    CREATED,
    UPDATED,
    DELETED,
  ];

  static final $core.Map<$core.int, UpdateType> _byValue =
      $pb.ProtobufEnum.initByValue(values);
  static UpdateType? valueOf($core.int value) => _byValue[value];

  const UpdateType._($core.int v, $core.String n) : super(v, n);

  static const bool _omitEnumNames =
      $core.bool.fromEnvironment('protobuf.omit_enum_names');
}

class BeaconConfigServiceClient extends $grpc.Client {
  static final _$getBeaconConfigs = $grpc.ClientMethod<GetBeaconConfigsRequest,
          GetBeaconConfigsResponse>(
      '/beaconconfig.BeaconConfigService/GetBeaconConfigs',
      (GetBeaconConfigsRequest value) => value.writeToBuffer(),
      ($core.List<$core.int> value) =>
          GetBeaconConfigsResponse.fromBuffer(value));
  static final _$updateBeaconConfig = $grpc.ClientMethod<UpdateBeaconConfigRequest,
          UpdateBeaconConfigResponse>(
      '/beaconconfig.BeaconConfigService/UpdateBeaconConfig',
      (UpdateBeaconConfigRequest value) => value.writeToBuffer(),
      ($core.List<$core.int> value) =>
          UpdateBeaconConfigResponse.fromBuffer(value));
  static final _$syncBeaconConfigs = $grpc.ClientMethod<SyncBeaconConfigsRequest,
          SyncBeaconConfigsResponse>(
      '/beaconconfig.BeaconConfigService/SyncBeaconConfigs',
      (SyncBeaconConfigsRequest value) => value.writeToBuffer(),
      ($core.List<$core.int> value) =>
          SyncBeaconConfigsResponse.fromBuffer(value));
  static final _$subscribeBeaconConfigUpdates = $grpc.ClientMethod<
          SubscribeBeaconConfigUpdatesRequest, BeaconConfigUpdate>(
      '/beaconconfig.BeaconConfigService/SubscribeBeaconConfigUpdates',
      (SubscribeBeaconConfigUpdatesRequest value) => value.writeToBuffer(),
      ($core.List<$core.int> value) => BeaconConfigUpdate.fromBuffer(value));

  BeaconConfigServiceClient($grpc.ClientChannel channel,
      {$grpc.CallOptions? options})
      : super(channel, options: options);

  $grpc.ResponseFuture<GetBeaconConfigsResponse> getBeaconConfigs(
      GetBeaconConfigsRequest request,
      {$grpc.CallOptions? options}) {
    return $createUnaryCall(_$getBeaconConfigs, request, options: options);
  }

  $grpc.ResponseFuture<UpdateBeaconConfigResponse> updateBeaconConfig(
      UpdateBeaconConfigRequest request,
      {$grpc.CallOptions? options}) {
    return $createUnaryCall(_$updateBeaconConfig, request, options: options);
  }

  $grpc.ResponseFuture<SyncBeaconConfigsResponse> syncBeaconConfigs(
      SyncBeaconConfigsRequest request,
      {$grpc.CallOptions? options}) {
    return $createUnaryCall(_$syncBeaconConfigs, request, options: options);
  }

  $grpc.ResponseStream<BeaconConfigUpdate> subscribeBeaconConfigUpdates(
      SubscribeBeaconConfigUpdatesRequest request,
      {$grpc.CallOptions? options}) {
    return $createStreamingCall(
        _$subscribeBeaconConfigUpdates, $grpc.ResponseStream.fromIterable([request]),
        options: options);
  }
}
