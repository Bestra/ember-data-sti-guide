App.ApplicationSerializer = DS.ActiveModelSerializer.extend({
  extractTypeName: function(prop, hash) {
    if (hash.type) {
      return this.typeForRoot(hash.type);
    } else {
      return this.typeForRoot(prop);
    }
  },
  primaryTypeName: function(primaryType) {
    return primaryType.typeKey;
  },
  extractSingle: function(store, primaryType, payload, recordId, requestType) {
    var hash, isFirstCreatedRecord, isPrimary, isUpdatedRecord, primaryRecord, primaryTypeName, prop, type, typeName, typeSerializer, _i, _len, _ref;
    payload = this.normalizePayload(primaryType, payload);
    primaryTypeName = this.primaryTypeName(primaryType);
    primaryRecord = void 0;
    for (prop in payload) {
      typeName = this.typeForRoot(prop);
      type = store.modelFor(typeName);
      isPrimary = type.typeKey === primaryTypeName;
      if (isPrimary && Ember.typeOf(payload[prop]) !== "array") {
        hash = payload[prop];
        typeName = this.extractTypeName(prop, hash);
        primaryType = store.modelFor(typeName);
        primaryRecord = this.normalize(primaryType, payload[prop], prop);
        continue;
      }
      _ref = payload[prop];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        hash = _ref[_i];
        typeName = this.extractTypeName(prop, hash);
        type = store.modelFor(typeName);
        typeSerializer = store.serializerFor(type);
        hash = typeSerializer.normalize(type, hash, prop);
        isFirstCreatedRecord = isPrimary && !recordId && !primaryRecord;
        isUpdatedRecord = isPrimary && this.coerceId(hash.id) === recordId;
        if (isFirstCreatedRecord || isUpdatedRecord) {
          primaryRecord = hash;
        } else {
          store.push(typeName, hash);
        }
      }
    }
    return primaryRecord;
  },
  coerceId: function(id) {
    if (id == null) {
      return null;
    } else {
      return id + "";
    }
  },
  extractArray: function(store, primaryType, payload) {
    var arrayTypeSerializer, forcedSecondary, isPrimary, normalizedArray, primaryArray, primaryTypeName, prop, type, typeKey, typeName;
    payload = this.normalizePayload(primaryType, payload);
    primaryTypeName = this.primaryTypeName(primaryType);
    primaryArray = void 0;
    for (prop in payload) {
      typeKey = prop;
      forcedSecondary = false;
      if (prop.charAt(0) === "_") {
        forcedSecondary = true;
        typeKey = prop.substr(1);
      }
      typeName = this.typeForRoot(typeKey);
      type = store.modelFor(typeName);
      arrayTypeSerializer = store.serializerFor(type);
      isPrimary = !forcedSecondary && (type.typeKey === primaryTypeName);
      normalizedArray = Ember.ArrayPolyfills.map.call(payload[prop], function(hash) {
        var itemSerializer, itemType;
        hash = this.normalizeType(hash);
        if (hash.type) {
          itemSerializer = store.serializerFor(hash.type);
        } else {
          itemSerializer = arrayTypeSerializer;
        }
        itemType = store.modelFor(this.extractTypeName(prop, hash));
        return itemSerializer.normalize(itemType, hash, prop);
      }, this);
      if (isPrimary) {
        primaryArray = normalizedArray;
      } else {
        store.pushMany(typeName, normalizedArray);
      }
    }
    return primaryArray;
  },
  pushPayload: function(store, payload) {
    var normalizedArray, prop, typeName;
    payload = this.normalizePayload(null, payload);
    for (prop in payload) {
      typeName = this.typeForRoot(prop);
      normalizedArray = Ember.ArrayPolyfills.map.call(Ember.makeArray(payload[prop]), function(hash) {
        var itemType;
        hash = this.normalizeType(hash);
        itemType = store.modelFor(this.extractTypeName(prop, hash));
        return this.normalize(itemType, hash, prop);
      }, this);
      store.pushMany(typeName, normalizedArray);
    }
  }
});

App.TaskSerializer = App.ApplicationSerializer.extend({
  primaryTypeName: function(primaryType) {
    return 'task';
  },
  serializeIntoHash: function(data, type, record, options) {
      var root;
      root = 'task';
      return data[root] = this.serialize(record, options);
    }
});

