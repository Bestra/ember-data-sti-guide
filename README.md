ember-data-sti-guide
====================

The ins and outs of implementing STI via ember data


Getting data in
================

##Finding a task
###You're going to need to override `push`
```coffeescript
push: (type, data, _partial) ->
    oldType = type
    dataType = data.type
    modelType = oldType
    if dataType && (@modelFor(oldType) != @modelFor(dataType))
      genericTypeRecord = @recordForId(oldType, data.id)
      modelType = dataType
      @dematerializeRecord(genericTypeRecord)
    @_super @modelFor(modelType), data, _partial
```

##Sideloading tasks
```coffeescript
# This is overridden because finding a 'task' and getting back a root key of 'author_task' will
  # break the isPrimary check.
  extractSingle: (store, primaryType, payload, recordId, requestType) ->
    payload = @normalizePayload(primaryType, payload)
    primaryTypeName = primaryType.typeKey
    primaryRecord = undefined
    for prop of payload
      typeName = @typeForRoot(prop)
      type = store.modelFor(typeName)
      isPrimary = type.typeKey is primaryTypeName
      # =======Custom check for primary type
      if payload[prop].parent_type == 'task'
        isPrimary = true
        primaryType = type
        primaryTypeName = type.typeKey
      else
        isPrimary = type.typeKey is primaryTypeName
      # =======Custom check for primary type
```

Sending data out
=================
###Serializing

All subtypes of task will have the same root key
```coffeescript
serializeIntoHash: (data, type, record, options) ->
      root = 'task'
      data[root] = this.serialize(record, options)
```
