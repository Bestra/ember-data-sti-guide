class CalendarDaySerializer < ActiveModel::Serializer
  attributes :id, :date, :label
  has_one :user, embed: :id
  has_many :tasks, embed: :ids, include: true, polymorphic: true
end
