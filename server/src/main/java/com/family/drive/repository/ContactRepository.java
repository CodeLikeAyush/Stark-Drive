package com.family.drive.repository;

import com.family.drive.model.Contact;
import com.family.drive.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ContactRepository extends JpaRepository<Contact, Long> {
    List<Contact> findByUser(User user);
    Optional<Contact> findByDeviceContactIdAndUser(String deviceContactId, User user);
    void deleteByDeviceContactIdAndUser(String deviceContactId, User user);
}
