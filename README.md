ember-data-sti-guide
====================

The ins and outs of implementing STI via ember data

##What is STI?
Before we talk about _how_ to implement STI, let's clarify what we're trying to get at here.
I'm going to use Tasks as our example model.
```
App.Task = DS.Model.extend({type: DS.attr('string')});
App.GroceryTask = App.Task.extend();
```
* I have an arbitrary number of subtypes of Task that share some of its properties.  Each subtype has a `type` attribute that the API sends down.
* When I ask the store for a Task by id, I could get back any subtype of Task (GroceryTask, DogWalkingTask, etc.)
  `this.store.find('task', 5) // could return a GroceryTask`
* Sideloaded Tasks should get put into the store as the correct type
* Given a CalendarDay that hasMany tasks, CalendarDay.tasks() should return a collection of subtypes of Task.
`App.CalendarDay = DS.Model.extend({tasks: DS.hasMany('task', {polymorphic: true})})`
* `task.save()` should hit `/api/tasks/` regardless of which subtype it is.  `/api/grocery_task/` is no good.

Stuff that needs to happen in both directions
==============

###The adapter
The adapter needs to use 'tasks' as its path to the api rather than 'grocery_tasks', etc.
```coffeescript
App.TaskAdapter = DS.ActiveModelAdapter.extend
  pathForType: (type) ->
    'tasks'
```

##Finding a task
You're going to need to override `push` on the store.  Why? Let's say you try to find a task from the store.  `@store.find('task', 1)`.  Internally this calls `store.findById()`, which in turn calls `@store.recordForId()` to initially look up the record. `recordForId` will _always_ return a record for the given type, __even if that record is empty__. If you look for a `Task` and get back a `GroceryTask` there's going to be an old `Task` sitting in the store that needs to be destroyed.
```
store.find() in a nutshell:
find -> findById -> recordForId (either finds the exiting record or puts an empty one into the store)
                 -> fetchById (if the record is empty)
                              -> (adapter makes ajax request)
                              -> push
```
With STI, the type that we find isn't necessarily the type we're going to get back.  We could ask the store for a `Task` and we're going to get back a `GroceryTask`.  When the adapter returns its `GroceryTask` payload to push into the store, the `Task` that was created by the very first `recordForId` call is still in the store in an empty state, and we need to remove it. 

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
##Associations

Sending data out
=================
###Serializing

All subtypes of task will have the same root key
```coffeescript
serializeIntoHash: (data, type, record, options) ->
      root = 'task'
      data[root] = this.serialize(record, options)
```
