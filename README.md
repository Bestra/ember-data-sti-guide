ember-data-sti-guide
====================

The ins and outs of dealing with STI via ember data

##STI?

[Single Table Inheritance] (http://www.martinfowler.com/eaaCatalog/singleTableInheritance.html) can be very good for solving certain data modeling problems on the server.  If you've tried to translate your STI models over to Ember you'll also know that it's not something ember data does out of the box.

Some quick notes on the tech stack we're using.
* Rails and ActiveModelSerializers
* Ember Data and the ActiveModelAdapter/Serializer


Before we talk about _how_ to translate our STI models to Ember, here are the assumptions I'm going to make about our API server. I'm going to use Tasks as our example model.

1. Task is an ActiveRecord object and it has an arbitrary number of subclasses.

```ruby
  class Task < ActiveRecord::Base end
  class GroceryTask < Task end
```

2. All requests go to a `/tasks/` route (I'm only using a `TasksController` for everything task-related).
3. The API will serialize any Task subtypes with a root key of `task` and include a `type` property.

    ```javascript
    {
      task: {id: 5, type: 'GroceryTask'} //single task
      tasks: [{id: 5, type: 'GroceryTask'}] //array of tasks
    }
    ```
##Ember

The Ember Store divides stores models in buckets based on the type of model (see the implementation of [recordForId](http://emberjs.com/api/data/classes/DS.Store.html#method_recordForId)).  It doesn't take subclasses into account.  For our implementation we didn't want to have to rewrite the store but rather try to satisfy the API's requirements with as few changes as possible relative to the existing code.  Once our models are in the Store they behave just like any other Model.  All the nasty stuff is confined to sending and recieving data from the API.  The stuff we're going to do isn't rocket science, but it touches the Adapter, Serializer, and Store in a few different places.  I'd highly recommend Tony Schneider's [Rainy Day Ember Data] (https://speakerdeck.com/tonywok/rainy-day-ember-data) presentation.  He lays out the parts of the serialization process very nicely.

Reiterating what we want to happen:
* Ember should use the `/tasks/` endpoint for anything task-related.  `store.find('task', 5)` and `someTask.save()` should hit `/tasks/*` regardless of which subtype it is.  `/grocery_tasks/` is no good.
* When I ask the store for a Task by id, I could get back any subtype of Task (GroceryTask, DogWalkingTask, etc.)  If I have a GroceryTask with id=5 on the server, then `this.store.find('task', 5)` should return a GroceryTask.
* Sideloaded Tasks should get put into the store as the correct type.

In Ember I'll make a Model hierarchy similar to the one in Rails.
```javascript
App.Task = DS.Model.extend({type: DS.attr('string')});
App.GroceryTask = App.Task.extend();
```


##Getting all subtypes of Task to use the same route on the api.
We can override the ActiveModelAdapter's [pathForType] (http://emberjs.com/api/data/classes/DS.ActiveModelAdapter.html#method_pathForType) function pretty easily. The adapter needs to use 'tasks' as its path to the api rather than 'grocery_tasks', etc.
```coffeescript
App.TaskAdapter = DS.ActiveModelAdapter.extend
  pathForType: (type) ->
    'tasks'
```

##Getting the appropriate subtype when we find a task by id.
This is going to take a little work.  First we're going to make a custom serializer for our application.  There are three methods to override: `extractSingle`, `extractArray`, and `pushPayload`.  We'll start with `extractSingle` and change the other methods in similar fashion.

###extractSingle
Let's say we call `store.find('task', 5)` and we get back the following payload

```javascript
{
  task: {id: 5, type: 'GroceryTask', user_id: 1},
  users: [{id:1, name: 'Chris'}]
}
```
The Serializer's `extractSingle` is used called during store.find('task', id) with the payload from the server.
There are two places we need to add functionality, labeled Change I and Change II below.

__Change I__

First, take a look at the signature for `extractSingle.`

`extractSingle: (store, primaryType, payload, recordId, requestType) ->`

`extractSingle` divides up the payload into two categories: the primary record and sideloaded data. It infers the key for the
primary record from its `primaryType` argument. When called via `store.find`, `primaryType` will be the
same as the type argument to `find`.  In the example payload above, since I called `store.find('task', 5)`
the key for the primary record will be `task`.  If you reload a model, `extractSingle` will be
called with that model's type.  For `aGroceryTask.reload()`, `primaryType` will be `App.GroceryTask`, and `extractSingle` is going to look for the primary record under `grocery_task:`, which in our case is wrong. We'll make a hook in `ApplicationSerializer` that our `TaskSerializer` can override later.

__Change II__

The primary record will be normalized based on its type and returned the `find` method.  The sideloaded data
will be normalized based on its type and immediately pushed into the store. In both cases we'll need to use some custom logic
to determine the 'type' of the record.

__The Serializer Code__

Despite all the code written below, the delta from the base implmentation is really small.  I've added 2 new methods (`extractTypeName` and `primaryTypeName`) and changed 3 lines of code inside `extractSingle`.
```coffeescript
App.ApplicationSerializer = DS.ActiveModelSerializer.extend
  # hash: the individual object in the payload, ie. {id: 5, type: 'GroceryTask'}
  # prop: the root key for the payload, ie. 'task'
  extractTypeName: (prop, hash) ->
    if hash.type
      @typeForRoot hash.type
    else
      @typeForRoot prop

  # allow the sti serializers to override this easily.
  primaryTypeName: (primaryType) ->
    primaryType.typeKey

  extractSingle: (store, primaryType, payload, recordId, requestType) ->
    payload = @normalizePayload(primaryType, payload)
    #***************************************************
    primaryTypeName = @primaryTypeName(primaryType) #<======= Change I
    #***************************************************
    primaryRecord = undefined
    for prop of payload
      typeName = @typeForRoot(prop)
      type = store.modelFor(typeName)
      isPrimary = type.typeKey is primaryTypeName
      # legacy support for singular resources
      if isPrimary and Ember.typeOf(payload[prop]) isnt "array"
        hash = payload[prop]
        #***************************************************
        typeName = @extractTypeName(prop, hash) #<========== Change II
        #***************************************************
        primaryType = store.modelFor(typeName)
        primaryRecord = @normalize(primaryType, payload[prop], prop)
        continue

      #jshint loopfunc:true
      for hash in payload[prop]
        #***************************************************
        typeName = @extractTypeName(prop, hash)#<=========== Change II
        #***************************************************
        type = store.modelFor(typeName)
        typeSerializer = store.serializerFor(type)
        hash = typeSerializer.normalize(type, hash, prop)
        isFirstCreatedRecord = isPrimary and not recordId and not primaryRecord
        isUpdatedRecord = isPrimary and @coerceId(hash.id) is recordId

        # find the primary record.
        #
        # It's either:
        # * the record with the same ID as the original request
        # * in the case of a newly created record that didn't have an ID, the first
        #   record in the Array
        if isFirstCreatedRecord or isUpdatedRecord
          primaryRecord = hash
        else
          store.push typeName, hash

    primaryRecord

App.TaskSerializer = App.ApplicationSerializer.extend
  primaryTypeName: (primaryType) ->
    'task'
```
Great! All of the sideloaded records are getting pushed into the store with the correct type at the end of
`extractSingle`.  What about the `primaryRecord`?
Take a deep breath.  You're going to need to extend your store's [push](http://emberjs.com/api/data/classes/DS.Store.html#method_push) method.
###WAT
Let's say you try to find a task from the store.  `store.find('task', 1)`.  What we actually want is _any subtype_ of Task with ID=1.  Ember doesn't know this out of the box.  It finds a `Task`, and is rather surprised when we get back a `GroceryTask`.
Internally this calls `store.findById()`, which in turn calls `store.recordForId()` to initially look up the record.
`recordForId` will push an empty record into the store if one isn't already there.
Normally that empty record would simply get replaced by the record that's coming back from the adapter, but in our case the record coming back might be of a different type. If you look for a `Task` and get back a `GroceryTask` there's going to be an old `Task` sitting in the store that needs to be destroyed.

```
store.find() in a nutshell:
find -> findById -> recordForId (either finds the exiting record or puts an empty one into the store)
                 -> fetchRecord (if the record is empty)
                              -> (adapter makes ajax request)
                              -> extractSingle
                              -> push

function calls:  find('task', 5) -> findById -> recordForId -> fetchRecord -> Serializer.extractSingle -> push('task')
Task record:                                      | Task:5                             |
GroceryTask record:                                                                    | GroceryTask:5

```
`push`'s first argument is the type of the incoming record.  In our case it's not always going to be correct.
We need to make sure that the correct subtype is always pushed into the store, even if that type differs from the type
that `push` was called with.
We also need to make sure that the empty superclass record that was created by `recordForId` gets deleted.  The best place to do this is right before the record we really want gets pushed into the store.

```coffeescript
App.Store = DS.Store.extend
  adapter: '-active-model'
  push: (type, data, _partial) ->
    oldType = type
    dataType = data.type
    modelType = oldType
    if dataType and (@modelFor(oldType) != @modelFor(dataType))
      modelType = dataType
      if oldRecord = @getById(oldType, data.id) #get rid of the empty supertype
        @dematerializeRecord(oldRecord)
    @_super @modelFor(modelType), data, _partial
```

###Fixing extractArray and pushPayload
`extractArray` and `pushPayload` both need to set the correct model subtype before pushing data into the store.  You can find the implementations in the code.js file in the repo.


Correctly Serializing Data
=================

When we save any subtype of task, it should be serialized under the root `task:`.
We can easily do this by overriding the TaskSerializer's [serializeIntoHash](http://emberjs.com/api/data/classes/DS.RESTSerializer.html#method_serializeIntoHash) method.
```coffeescript
App.TaskSerializer = App.ApplicationSerializer.extend
  primaryTypeName: (primaryType) ->
    'task'
  serializeIntoHash: (data, type, record, options) ->
    root = 'task'
    data[root] = this.serialize(record, options)
```
Polymorphic Assocations
=================================
Given a CalendarDay that hasMany tasks, CalendarDay.tasks() should return a collection of subtypes of Task.  This isn't directly related to STI, but it's still necessary for our client app.
When Ember Data normalizes a polymorphic relationship it expects a different payload than usual.
Here's a normal payload.
```javascript
  {
    calendar_day: {
                    id: 5,
                    date: '3/10',
                    task_ids: [1, 2] //embed task ids.
                  },
    //sideload tasks
    tasks: [{id: 1, timeAlloted: 25},
            {id: 2, timeAlloted: 30}]
  }
```
Now say my CalendarDay has many subtypes of task.
```javascript
App.CalendarDay = DS.Model.extend({
  id: DS.attr(),
  date: DS.attr(),
  tasks: DS.hasMany({polymorphic: true})
})
```
Here's the payload CalendarDay will expect for the polymorphic association.
```javascript
  {
    calendar_day: {
                    id: 5,
                    date: '3/10',
                    //embed objects with id and type
                    tasks: [{id: 1, type: 'GroceryTask'},
                            {id: 2, type: 'DogTask'}]
                  },
    //sideload tasks like usual
    tasks: [{id: 1, type: 'GroceryTask', timeAlloted: 25, date: '3/10'},
            {id: 2, type: 'DogTask', timeAlloted: 30, dog: 'Yeller'}]
  }
```

If you're using ActiveModelSerializers you can use the included initializer (credit to @tonyWok).


