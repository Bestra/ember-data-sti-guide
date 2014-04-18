ember-data-sti-guide
====================

The ins and outs of dealing with STI via ember data

##STI?

[Single Table Inheritance] (http://www.martinfowler.com/eaaCatalog/singleTableInheritance.html) can be very good for solving certain data modeling problems on the server.  If you've tried to translate your STI models over to Ember you'll also know that it's not something ember data does out of the box.

Before we talk about _how_ to translate our STI models to Ember, let's clarify what we actually want to have happen.
I'm going to use Tasks as our example model.
```
App.Task = DS.Model.extend({type: DS.attr('string')});
App.GroceryTask = App.Task.extend();
```
Conceiveably a `GroceryTask` will have `type: 'GroceryTask'`.
* My API is only going to have one endpoint for anything task-related.  `store.find('task', 5)` and `someTask.save()` should hit `/tasks/*` regardless of which subtype it is.  `/grocery_tasks/` is no good.
* When I ask the store for a Task by id, I could get back any subtype of Task (GroceryTask, DogWalkingTask, etc.)  If I have a GroceryTask with id=5 on the server, then `this.store.find('task', 5)` should return a GroceryTask.
* Sideloaded Tasks should get put into the store as the correct type.

##All subtypes of Task should use the same route on the api.
We can override adapter's `pathForType()` function pretty easily. The adapter needs to use 'tasks' as its path to the api rather than 'grocery_tasks', etc.
```coffeescript
App.TaskAdapter = DS.ActiveModelAdapter.extend
  pathForType: (type) ->
    'tasks'
```

##When we find a task by id we should get the appropriate subtype.
Take a deep breath.  You're going to need to extend `DS.Store`.
###WAT
Let's say you try to find a task from the store.  `@store.find('task', 1)`.  
Internally this calls `store.findById()`, which in turn calls `@store.recordForId()` to initially look up the record. `recordForId` will _always_ return a record for the given type, __even if that record is empty__. If you look for a `Task` and get back a `GroceryTask` there's going to be an old `Task` sitting in the store that needs to be destroyed.
```
store.find() in a nutshell:
find -> findById -> recordForId (either finds the exiting record or puts an empty one into the store)
                 -> fetchById (if the record is empty)
                              -> (adapter makes ajax request) -> extractSingle
                                                                       -> push
                              
function calls:  find('task', 5) -> findById -> recordForId -> fetchById -> Serializer.extractSingle -> push
Task record:                                      | Task:5                             |
GroceryTask record:                                                                    | GroceryTask:5
```
With STI, the type that we find isn't necessarily the type we're going to get back.  We could ask the store for a `Task` and we're going to get back a `GroceryTask`.  When the adapter returns its `GroceryTask` payload to push into the store, the `Task` that was created by the very first `recordForId` call is still in the store in an empty state, and we need to remove it. 

```coffeescript
push: (type, data, _partial) ->
    oldType = type
    dataType = data.type
    modelType = oldType
    if dataType && (@modelFor(oldType) != @modelFor(dataType))
      genericTypeRecord = @recordForId(oldType, data.id) #find the original record made by recordForId
      modelType = dataType
      @dematerializeRecord(genericTypeRecord)
    @_super @modelFor(modelType), data, _partial
```

##Sideloading tasks by type
The Serializer's `extractSingle` is used called during store.find('task', id) with the payload from the server.  There are two places we need to add functionality.  
Let's say we call `store.find('task', 5)` and we get back the following payload

```javascript
{
  grocery_task: {id: 5, parent_type: 'task', type: 'GroceryTask', user_id: 1},
  users: [{id:1, name: 'Chris'}]
}
```
The payload could have an abitrary amount of sideloaded data in addition to the record we asked for, and ember has to pick out the 'primary record' to return to us.  Normally it's easy: ember uses the type we requested in `find()`, or 'task' in our case.  Unfortunately our API has returned 'grocery_task' so we need another way to pick out the primary record.  I've added a pa  
**WHY ARE WE DOING THIS INSTEAD OF JUST RETURNING TASK**

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
      # =======>Custom check for primary type
      if payload[prop].parent_type == 'task' && payload[prop].id == recordId
        isPrimary = true
        primaryType = type
        primaryTypeName = type.typeKey
      else
        isPrimary = type.typeKey is primaryTypeName
      # <=======Custom check for primary type
      
      # legacy support for singular resources
      if isPrimary and Ember.typeOf(payload[prop]) isnt "array"
        primaryRecord = @normalize(primaryType, payload[prop], prop)
        continue

      #jshint loopfunc:true
      for hash in payload[prop]
        # hash.foobar = 'hello!'
        # ========>Custom check for STI type
        typeName = if hash.type
          hash.qualified_type = hash.type
          hash.type = hash.type.replace(/.+::/, '')
          @typeForRoot hash.type
        else
          @typeForRoot prop
        # <=======Custom check for STI type
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
Bonus: Polymorphic Assocations
=================================
* Given a CalendarDay that hasMany tasks, CalendarDay.tasks() should return a collection of subtypes of Task.  This isn't directly related to STI, but it's still necessary for our client app.  

